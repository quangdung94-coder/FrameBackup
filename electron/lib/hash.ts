import { createHash } from 'node:crypto';
import fs from 'node:fs';
import xxhash from 'xxhash-wasm';
import { cancelledError } from './errors';

/** Kích thước buffer đọc/ghi stream khi copy & hash (4 MB). */
export const STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

let xxhashApiPromise: ReturnType<typeof xxhash> | null = null;

/** Khởi tạo xxhash-wasm 1 lần, dùng lại cho mọi file. */
export function getXxhash() {
  if (!xxhashApiPromise) {
    xxhashApiPromise = xxhash();
  }
  return xxhashApiPromise;
}

/** XXHash64 (hex) của 1 file, hủy được bằng signal. */
export async function hashFileXx64(filePath: string, signal: AbortSignal): Promise<string> {
  const api = await getXxhash();
  const hasher = api.create64();
  return new Promise<string>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: STREAM_CHUNK_BYTES });
    const onAbort = () => {
      stream.destroy();
      reject(cancelledError());
    };
    // Gắn handler lỗi TRƯỚC khi có thể hủy: nếu Dừng đúng lúc file đang mở/bị xoá,
    // stream vẫn phát 'error' và không làm văng main process (lỗi D16).
    stream.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
    stream.on('data', (chunk: Buffer | string) => {
      hasher.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.on('end', () => {
      signal.removeEventListener('abort', onAbort);
      resolve(hasher.digest().toString(16));
    });
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** MD5 (hex) của 1 file — so với md5Checksum của Google Drive. */
export async function hashFileMd5(filePath: string, signal: AbortSignal): Promise<string> {
  const hasher = createHash('md5');
  return new Promise<string>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: STREAM_CHUNK_BYTES });
    const onAbort = () => {
      stream.destroy();
      reject(cancelledError());
    };
    stream.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
    stream.on('data', (chunk: Buffer | string) => hasher.update(chunk));
    stream.on('end', () => {
      signal.removeEventListener('abort', onAbort);
      resolve(hasher.digest('hex'));
    });
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
