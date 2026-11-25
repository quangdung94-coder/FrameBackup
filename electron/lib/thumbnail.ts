import fsp from 'node:fs/promises';
import exifr from 'exifr';
import ffmpegPathRaw from 'ffmpeg-static';
import { resolveUnpackedBinary } from './binaries';
import { execFileAsync } from './exec';

export const ffmpegPath = resolveUnpackedBinary(ffmpegPathRaw);

export interface ThumbOptions {
  width?: number;
  quality?: number;
  seekSec?: number;
  timeoutMs?: number;
  runFfmpeg?: <T>(fn: () => Promise<T>) => Promise<T>;
}

async function execFfmpeg(args: string[], timeout: number, runner?: ThumbOptions['runFfmpeg']): Promise<boolean> {
  if (!ffmpegPath) return false;
  const task = () => execFileAsync(ffmpegPath!, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout });
  try {
    await (runner ? runner(task) : task());
    return true;
  } catch {
    return false;
  }
}

/** Trích xuất thumbnail JPEG cho ảnh (ưu tiên EXIF Embedded Preview với RAW/JPG, fallback sang ffmpeg). */
export async function extractImageThumb(imagePath: string, outJpgPath: string, opts: ThumbOptions = {}): Promise<boolean> {
  try {
    const thumbBuf = await exifr.thumbnail(imagePath);
    if (thumbBuf && thumbBuf.length > 0) {
      await fsp.writeFile(outJpgPath, Buffer.from(thumbBuf));
      return true;
    }
  } catch {
    // Fallback sang ffmpeg bên dưới
  }

  const width = opts.width ?? 640;
  const quality = opts.quality ?? 3;
  return execFfmpeg(['-i', imagePath, '-vframes', '1', '-vf', `scale=${width}:-2`, '-q:v', String(quality), '-y', outJpgPath], opts.timeoutMs ?? 20000, opts.runFfmpeg);
}

/** Trích xuất 1 khung hình JPEG cho video bằng ffmpeg (thử seekSec rồi fallback về 0s). */
export async function extractVideoThumb(videoPath: string, outJpgPath: string, opts: ThumbOptions = {}): Promise<boolean> {
  const width = opts.width ?? 640;
  const quality = opts.quality ?? 3;
  const seek = opts.seekSec ?? 1;
  const timeout = opts.timeoutMs ?? 25000;

  if (seek > 0) {
    const ok = await execFfmpeg(
      ['-ss', seek.toFixed(2), '-i', videoPath, '-vframes', '1', '-vf', `scale=${width}:-2`, '-q:v', String(quality), '-an', '-y', outJpgPath],
      timeout,
      opts.runFfmpeg
    );
    if (ok) return true;
  }
  return execFfmpeg(
    ['-i', videoPath, '-vframes', '1', '-vf', `scale=${width}:-2`, '-q:v', String(quality), '-an', '-y', outJpgPath],
    timeout,
    opts.runFfmpeg
  );
}
