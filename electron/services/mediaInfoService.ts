import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';
import ffmpegPathRaw from 'ffmpeg-static';
import { resolveUnpackedBinary } from '../lib/binaries';
import { execFileAsync } from '../lib/exec';
import type { MediaInfo, MediaThumbRequest } from '../shared/types';

/**
 * v1.4 mục 4: thông tin clip / ảnh cho kiểu xem (thời lượng, độ phân giải, fps, codec, máy quay)
 * và hình thu nhỏ / dải hình tua nhanh. Đọc lười theo file đang hiện trên màn hình, có cache.
 */

const ffmpegPath = resolveUnpackedBinary(ffmpegPathRaw);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'mts', 'm2ts', 'mxf', 'avi', 'mkv', 'insv', 'lrv', '3gp', 'wmv', 'webm', 'braw', 'r3d', 'crm']);
const QT_EXT = new Set(['mp4', 'mov', 'm4v', 'insv', 'lrv', '3gp']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'tif', 'tiff', 'webp', 'arw', 'cr2', 'cr3', 'nef', 'raf', 'rw2', 'orf', 'dng', 'srw', 'pef']);

let cacheDir = '';
export function initMediaInfo(userDataDir: string) {
  cacheDir = path.join(userDataDir, 'thumbs');
}

const extOf = (p: string) => path.extname(p).slice(1).toLowerCase();

// ---------------- Giới hạn số tiến trình chạy cùng lúc ----------------
function limiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
const ffmpegSlot = limiter(2); // video 4K H.265 giải mã nặng: tối đa 2 tiến trình ffmpeg cùng lúc
const probeSlot = limiter(6);

// ---------------- Đọc hộp MP4 / MOV (không cần ffmpeg) ----------------
interface Box {
  type: string;
  start: number; // vị trí nội dung (sau header)
  end: number;
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header) return;
    yield { type, start: pos + header, end: Math.min(end, pos + size) };
    pos += size;
  }
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  for (const b of boxes(buf, parent.start, parent.end)) if (b.type === type) return b;
  return undefined;
}

const CODECS: Record<string, string> = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'H.265',
  hev1: 'H.265',
  apcn: 'ProRes 422',
  apch: 'ProRes 422 HQ',
  apcs: 'ProRes 422 LT',
  apco: 'ProRes Proxy',
  ap4h: 'ProRes 4444',
  ap4x: 'ProRes 4444 XQ',
  mp4v: 'MPEG-4',
  av01: 'AV1',
  vp09: 'VP9',
};

/** Đọc moov (thường ở cuối file với máy quay) => thời lượng, kích thước, fps, codec. */
async function probeQuickTime(filePath: string): Promise<MediaInfo | null> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const { size: fileSize } = await fh.stat();
    const head = Buffer.alloc(16);
    let pos = 0;
    let moov: Buffer | null = null;
    while (pos + 8 <= fileSize) {
      await fh.read(head, 0, 16, pos);
      let size = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let hdr = 8;
      if (size === 1) {
        size = Number(head.readBigUInt64BE(8));
        hdr = 16;
      } else if (size === 0) size = fileSize - pos;
      if (size < hdr) break;
      if (type === 'moov') {
        if (size > 64 * 1024 * 1024) return null;
        moov = Buffer.alloc(size - hdr);
        await fh.read(moov, 0, moov.length, pos + hdr);
        break;
      }
      pos += size;
    }
    if (!moov) return null;
    const root: Box = { type: 'moov', start: 0, end: moov.length };
    const info: MediaInfo = {};
    const mvhd = child(moov, root, 'mvhd');
    if (mvhd) {
      const v = moov[mvhd.start];
      const ts = moov.readUInt32BE(mvhd.start + (v === 1 ? 20 : 12));
      const dur = v === 1 ? Number(moov.readBigUInt64BE(mvhd.start + 24)) : moov.readUInt32BE(mvhd.start + 16);
      if (ts > 0) info.durationSec = dur / ts;
    }
    for (const trak of boxes(moov, 0, moov.length)) {
      if (trak.type !== 'trak') continue;
      const mdia = child(moov, trak, 'mdia');
      const hdlr = mdia && child(moov, mdia, 'hdlr');
      if (!mdia || !hdlr || moov.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;
      const tkhd = child(moov, trak, 'tkhd');
      if (tkhd) {
        const off = tkhd.start + (moov[tkhd.start] === 1 ? 88 : 76);
        if (off + 8 <= tkhd.end) {
          info.width = Math.round(moov.readUInt32BE(off) / 65536);
          info.height = Math.round(moov.readUInt32BE(off + 4) / 65536);
        }
      }
      const mdhd = child(moov, mdia, 'mdhd');
      const stbl = (() => {
        const minf = child(moov!, mdia, 'minf');
        return minf && child(moov!, minf, 'stbl');
      })();
      if (stbl) {
        const stsd = child(moov, stbl, 'stsd');
        if (stsd && stsd.start + 16 <= stsd.end) {
          const fourcc = moov.toString('latin1', stsd.start + 12, stsd.start + 16);
          info.codec = CODECS[fourcc] ?? fourcc.trim();
          // Kích thước thật trong sample entry (tkhd có thể bị xoay / đặt 0)
          const w = moov.readUInt16BE(stsd.start + 8 + 32);
          const h = moov.readUInt16BE(stsd.start + 8 + 34);
          if (w > 0 && h > 0 && (!info.width || !info.height)) {
            info.width = w;
            info.height = h;
          }
        }
        const stts = child(moov, stbl, 'stts');
        if (mdhd && stts) {
          const v = moov[mdhd.start];
          const ts = moov.readUInt32BE(mdhd.start + (v === 1 ? 20 : 12));
          const dur = v === 1 ? Number(moov.readBigUInt64BE(mdhd.start + 24)) : moov.readUInt32BE(mdhd.start + 16);
          const n = moov.readUInt32BE(stts.start + 4);
          let samples = 0;
          for (let i = 0; i < n && stts.start + 8 + i * 8 + 8 <= stts.end; i++) samples += moov.readUInt32BE(stts.start + 8 + i * 8);
          if (ts > 0 && dur > 0 && samples > 0) info.fps = Math.round((samples * ts * 100) / dur) / 100;
        }
      }
      break;
    }
    return info.durationSec !== undefined ? info : null;
  } finally {
    await fh.close();
  }
}

/** Định dạng khác (MTS, MXF, AVI...) => đọc phần thông tin ffmpeg in ra. */
async function probeWithFfmpeg(filePath: string): Promise<MediaInfo | null> {
  if (!ffmpegPath) return null;
  let text = '';
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], { windowsHide: true, timeout: 15000 });
  } catch (err) {
    text = String((err as { stderr?: string }).stderr ?? '');
  }
  const info: MediaInfo = {};
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (d) info.durationSec = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const v = /Stream #[^\n]*Video:\s*([a-z0-9_]+)[^\n]*?(\d{2,5})x(\d{2,5})/i.exec(text);
  if (v) {
    info.codec = ({ h264: 'H.264', hevc: 'H.265', prores: 'ProRes', mpeg2video: 'MPEG-2' } as Record<string, string>)[v[1]] ?? v[1];
    info.width = Number(v[2]);
    info.height = Number(v[3]);
  }
  const f = /Video:[^\n]*?([\d.]+) fps/.exec(text);
  if (f) info.fps = Number(f[1]);
  const m = /\bmodel\s*:\s*(.+)/i.exec(text);
  if (m) info.cameraModel = m[1].trim();
  return info.durationSec !== undefined || info.width ? info : null;
}

/** Sony: file XML đi kèm (C0001M01.XML) ghi tên máy & fps. */
async function readSonyXml(videoPath: string): Promise<Partial<MediaInfo>> {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  for (const name of [`${base}M01.XML`, `${base}M01.xml`]) {
    try {
      const xml = await fsp.readFile(path.join(dir, name), 'utf8');
      const out: Partial<MediaInfo> = {};
      const maker = /<Device[^>]*manufacturer="([^"]+)"/.exec(xml)?.[1];
      const model = /<Device[^>]*modelName="([^"]+)"/.exec(xml)?.[1];
      if (model) out.cameraModel = maker && !model.startsWith(maker) ? `${maker} ${model}` : model;
      return out;
    } catch {
      // thử tên khác
    }
  }
  return {};
}

async function probeImage(filePath: string): Promise<MediaInfo> {
  try {
    const t = await exifr.parse(filePath, {
      pick: ['Make', 'Model', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight'],
    });
    if (!t) return {};
    const model = typeof t.Model === 'string' ? t.Model.trim() : '';
    const make = typeof t.Make === 'string' ? t.Make.trim() : '';
    return {
      width: t.ExifImageWidth ?? t.ImageWidth,
      height: t.ExifImageHeight ?? t.ImageHeight,
      cameraModel: model ? (make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${model}` : model) : undefined,
    };
  } catch {
    return {};
  }
}

const infoCache = new Map<string, MediaInfo>();

async function probeOne(filePath: string): Promise<MediaInfo> {
  const ext = extOf(filePath);
  let st;
  try {
    st = await fsp.stat(filePath);
  } catch {
    return {};
  }
  const key = `${filePath}|${st.size}|${st.mtimeMs}`;
  const hit = infoCache.get(key);
  if (hit) return hit;
  let info: MediaInfo = {};
  if (VIDEO_EXT.has(ext)) {
    if (QT_EXT.has(ext)) info = (await probeQuickTime(filePath).catch(() => null)) ?? {};
    if (info.durationSec === undefined) info = { ...info, ...((await ffmpegSlot(() => probeWithFfmpeg(filePath))) ?? {}) };
    const xml = await readSonyXml(filePath);
    if (xml.cameraModel) info.cameraModel = xml.cameraModel;
  } else if (IMAGE_EXT.has(ext)) {
    info = await probeImage(filePath);
  }
  infoCache.set(key, info);
  return info;
}

export async function probeMediaInfo(paths: string[]): Promise<Record<string, MediaInfo>> {
  const out: Record<string, MediaInfo> = {};
  await Promise.all(paths.slice(0, 2000).map((p) => probeSlot(async () => (out[p] = await probeOne(p)))));
  return out;
}

// ---------------- Hình thu nhỏ & dải hình tua nhanh ----------------
async function cacheFileFor(filePath: string, kind: string): Promise<string | null> {
  try {
    const st = await fsp.stat(filePath);
    const h = createHash('sha1').update(`${filePath}|${st.size}|${st.mtimeMs}|${kind}`).digest('hex');
    return path.join(cacheDir, h.slice(0, 2), `${h}.jpg`);
  } catch {
    return null;
  }
}

async function readAsDataUrl(p: string): Promise<string | null> {
  try {
    const buf = await fsp.readFile(p);
    return buf.length > 0 ? `data:image/jpeg;base64,${buf.toString('base64')}` : null;
  } catch {
    return null;
  }
}

async function runFfmpeg(args: string[], timeout = 30000): Promise<boolean> {
  if (!ffmpegPath) return false;
  try {
    await ffmpegSlot(() => execFileAsync(ffmpegPath!, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout }));
    return true;
  } catch {
    return false;
  }
}

const inflight = new Map<string, Promise<string | null>>();
function once(key: string, fn: () => Promise<string | null>): Promise<string | null> {
  const cur = inflight.get(key);
  if (cur) return cur;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const THUMB_W = 320;

export function getMediaThumbnail(req: MediaThumbRequest): Promise<string | null> {
  const filePath = req.path;
  return once(`t|${filePath}`, async () => {
    const out = await cacheFileFor(filePath, `thumb${THUMB_W}`);
    if (!out) return null;
    const cached = await readAsDataUrl(out);
    if (cached) return cached;
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const ext = extOf(filePath);
    let ok = false;
    if (IMAGE_EXT.has(ext)) {
      try {
        const buf = await exifr.thumbnail(filePath);
        if (buf && buf.length > 0) {
          await fsp.writeFile(out, Buffer.from(buf));
          ok = true;
        }
      } catch {
        // ffmpeg bên dưới
      }
      if (!ok) ok = await runFfmpeg(['-i', filePath, '-vframes', '1', '-vf', `scale=${THUMB_W}:-2`, '-q:v', '4', '-y', out]);
    } else if (VIDEO_EXT.has(ext)) {
      const info = await probeOne(filePath);
      const seek = info.durationSec && info.durationSec > 3 ? Math.min(1, info.durationSec / 10) : 0;
      ok = await runFfmpeg(['-ss', seek.toFixed(2), '-i', filePath, '-vframes', '1', '-vf', `scale=${THUMB_W}:-2`, '-q:v', '4', '-an', '-y', out]);
      if (!ok && seek > 0) ok = await runFfmpeg(['-i', filePath, '-vframes', '1', '-vf', `scale=${THUMB_W}:-2`, '-q:v', '4', '-an', '-y', out]);
    }
    return ok ? readAsDataUrl(out) : null;
  });
}
