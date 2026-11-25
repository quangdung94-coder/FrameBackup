import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DateSource } from '../shared/types';
import { readMediaShotDate } from './metadataService';

/**
 * Bộ nhớ ngày chụp (lưu trong thư mục dữ liệu app): đọc EXIF / thông tin MP4 của 1 file 1 lần,
 * lần sau (cắm lại thẻ cũ, chép, báo cáo) lấy ngay. Khóa = đường dẫn + dung lượng + giờ sửa,
 * file đổi nội dung thì tự đọc lại.
 */

interface DateEntry {
  d: number; // shotTimeMs
  s: DateSource;
  t: number; // lần dùng gần nhất
}

interface CacheFile {
  version: 1;
  entries: Record<string, DateEntry>;
}

const MAX_ENTRIES = 400_000;
const SAVE_DELAY_MS = 3_000;

let cachePath = '';
let data: CacheFile = { version: 1, entries: {} };
let saveTimer: NodeJS.Timeout | null = null;

const keyOf = (fullPath: string, size: number, mtimeMs: number) => {
  const abs = path.resolve(fullPath);
  const p = process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs;
  return `${p}|${size}|${Math.floor(mtimeMs)}`;
};

export function initShotDateCache(userDataDir: string) {
  cachePath = path.join(userDataDir, 'shot-date-cache.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CacheFile;
    if (parsed && parsed.version === 1 && parsed.entries) data = parsed;
  } catch {
    // chưa có bộ nhớ => bắt đầu mới
  }
}

function prune() {
  const keys = Object.keys(data.entries);
  if (keys.length <= MAX_ENTRIES) return;
  keys.sort((a, b) => data.entries[a].t - data.entries[b].t);
  for (const k of keys.slice(0, keys.length - Math.floor(MAX_ENTRIES * 0.8))) delete data.entries[k];
}

function scheduleSave() {
  if (!cachePath || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, SAVE_DELAY_MS);
}

async function saveNow() {
  if (!cachePath) return;
  prune();
  try {
    const tmp = `${cachePath}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, cachePath);
  } catch (err) {
    console.error('[shotDateCache] save failed:', err);
  }
}

export function flushShotDateCache() {
  if (!cachePath) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    prune();
    fs.writeFileSync(cachePath, JSON.stringify(data));
  } catch {
    // bỏ qua khi thoát app
  }
}

/** Ngày chụp đã biết (không đọc file). null = chưa đọc. */
export function cachedShotDate(fullPath: string, size: number, mtimeMs: number): { shotTimeMs: number; dateSource: DateSource } | null {
  const e = data.entries[keyOf(fullPath, size, mtimeMs)];
  if (!e) return null;
  e.t = Date.now();
  return { shotTimeMs: e.d, dateSource: e.s };
}

/** Đọc ngày chụp (có nhớ). */
export async function readShotDateCached(
  fullPath: string,
  size: number,
  mtimeMs: number
): Promise<{ shotTimeMs: number; dateSource: DateSource }> {
  const hit = cachedShotDate(fullPath, size, mtimeMs);
  if (hit) return hit;
  const meta = await readMediaShotDate(fullPath, mtimeMs);
  data.entries[keyOf(fullPath, size, mtimeMs)] = { d: meta.shotTimeMs, s: meta.dateSource, t: Date.now() };
  scheduleSave();
  return meta;
}
