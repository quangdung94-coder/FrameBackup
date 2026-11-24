import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import xxhash from 'xxhash-wasm';
import { scanFilesRecursive, type FileEntry } from './diskService';

export type DateFilterMode = 'all' | 'target-only' | 'split';

export interface CopyVerifyRequest {
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  sourceDir: string;
  destDir: string;
  targetDate?: string;
  overnightMode?: boolean;
  dateFilterMode?: DateFilterMode;
}

export interface CopyProgressEvent {
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  status: 'scanning' | 'copying' | 'verifying' | 'completed' | 'cancelled' | 'error';
  currentFile: string;
  filesCompleted: number;
  totalFiles: number;
  skippedFiles: number;
  verifiedFiles: number;
  bytesCopied: number;
  totalBytes: number;
  percent: number;
  speedMBs: number;
  error?: string;
}

export interface CopyVerifySummary {
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  success: boolean;
  totalFiles: number;
  copiedFiles: number;
  verifiedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  destDir: string;
  error?: string;
}

let activeAbortController: AbortController | null = null;
let xxhashApiPromise: ReturnType<typeof xxhash> | null = null;

function getXxhash() {
  if (!xxhashApiPromise) {
    xxhashApiPromise = xxhash();
  }
  return xxhashApiPromise;
}

function formatDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isMatchingTargetDate(shotTimeMs: number, targetDate?: string, overnightMode = true): boolean {
  if (!targetDate) return true;
  const fileKey = formatDateKey(shotTimeMs);
  if (fileKey === targetDate) return true;
  if (overnightMode) {
    const fileDate = new Date(shotTimeMs);
    const targetStart = new Date(`${targetDate}T00:00:00`);
    const nextDay = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);
    if (fileKey === formatDateKey(nextDay.getTime()) && fileDate.getHours() < 4) {
      return true;
    }
  }
  return false;
}

async function hashFileXx64(filePath: string, signal: AbortSignal): Promise<string> {
  const api = await getXxhash();
  const hasher = api.create64();
  return new Promise<string>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    const onAbort = () => {
      stream.destroy();
      reject(new Error('CANCELLED'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    stream.on('data', (chunk: Buffer | string) => {
      hasher.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
    stream.on('end', () => {
      signal.removeEventListener('abort', onAbort);
      resolve(hasher.digest().toString(16));
    });
  });
}

async function copyFileAndHashSource(
  srcPath: string,
  destPath: string,
  signal: AbortSignal,
  onChunk: (bytes: number) => void
): Promise<string> {
  const api = await getXxhash();
  const hasher = api.create64();
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  return new Promise<string>((resolve, reject) => {
    const reader = fs.createReadStream(srcPath, { highWaterMark: 4 * 1024 * 1024 });
    const writer = fs.createWriteStream(destPath, { highWaterMark: 4 * 1024 * 1024 });

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      reader.destroy();
      writer.destroy();
      reject(new Error('CANCELLED'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    reader.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      hasher.update(buf);
      onChunk(buf.length);
    });

    reader.on('error', (err) => {
      cleanup();
      writer.destroy();
      reject(err);
    });

    writer.on('error', (err) => {
      cleanup();
      reader.destroy();
      reject(err);
    });

    writer.on('finish', () => {
      cleanup();
      resolve(hasher.digest().toString(16));
    });

    reader.pipe(writer);
  });
}

export function cancelActiveCopy(): boolean {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    return true;
  }
  return false;
}

export async function runCopyAndVerify(
  req: CopyVerifyRequest,
  onProgress: (ev: CopyProgressEvent) => void
): Promise<CopyVerifySummary> {
  if (activeAbortController) {
    activeAbortController.abort();
  }
  const controller = new AbortController();
  activeAbortController = controller;
  const { signal } = controller;

  const emit = (partial: Omit<CopyProgressEvent, 'stage'>) => {
    onProgress({ stage: req.stage, ...partial });
  };

  try {
    emit({
      status: 'scanning',
      currentFile: 'Đang quét danh sách file & metadata...',
      filesCompleted: 0,
      totalFiles: 0,
      skippedFiles: 0,
      verifiedFiles: 0,
      bytesCopied: 0,
      totalBytes: 0,
      percent: 0,
      speedMBs: 0,
    });

    const allFiles = await scanFilesRecursive(req.sourceDir, req.stage === 'card-to-drive1');
    const filterMode = req.dateFilterMode ?? 'all';

    let skippedFiles = 0;
    const filesToCopy: FileEntry[] = [];

    for (const f of allFiles) {
      if (
        req.stage === 'card-to-drive1' &&
        filterMode === 'target-only' &&
        !isMatchingTargetDate(f.shotTimeMs, req.targetDate, req.overnightMode ?? true)
      ) {
        skippedFiles += 1;
        continue;
      }
      filesToCopy.push(f);
    }

    const totalBytes = filesToCopy.reduce((sum, f) => sum + f.sizeBytes, 0);
    const totalFiles = filesToCopy.length;
    let bytesCopied = 0;
    let filesCompleted = 0;
    let verifiedFiles = 0;
    const startedAt = Date.now();
    let lastEmitAt = 0;

    await fsp.mkdir(req.destDir, { recursive: true });

    for (const file of filesToCopy) {
      if (signal.aborted) throw new Error('CANCELLED');

      let destPath: string;
      if (req.stage === 'card-to-drive1' && filterMode === 'split') {
        const folderDate = formatDateKey(file.shotTimeMs).replace(/-/g, '.');
        destPath = path.join(req.destDir, folderDate, file.relativePath);
      } else {
        destPath = path.join(req.destDir, file.relativePath);
      }

      const srcHash = await copyFileAndHashSource(file.fullPath, destPath, signal, (chunkBytes) => {
        bytesCopied += chunkBytes;
        const now = Date.now();
        if (now - lastEmitAt > 120) {
          lastEmitAt = now;
          const elapsedSec = Math.max((now - startedAt) / 1000, 0.1);
          const speedMBs = Number((bytesCopied / (1024 * 1024) / elapsedSec).toFixed(1));
          const percent = totalBytes > 0 ? Math.min(99, Math.round((bytesCopied / totalBytes) * 100)) : 0;
          emit({
            status: 'copying',
            currentFile: file.name,
            filesCompleted,
            totalFiles,
            skippedFiles,
            verifiedFiles,
            bytesCopied,
            totalBytes,
            percent,
            speedMBs,
          });
        }
      });

      // Preserve original mtime on destination file
      const mtimeDate = new Date(file.mtimeMs);
      await fsp.utimes(destPath, mtimeDate, mtimeDate).catch(() => {});

      // Verify destination with XXHash64
      emit({
        status: 'verifying',
        currentFile: `Verify XXHash64: ${file.name}`,
        filesCompleted,
        totalFiles,
        skippedFiles,
        verifiedFiles,
        bytesCopied,
        totalBytes,
        percent: totalBytes > 0 ? Math.min(99, Math.round((bytesCopied / totalBytes) * 100)) : 0,
        speedMBs: Number((bytesCopied / (1024 * 1024) / Math.max((Date.now() - startedAt) / 1000, 0.1)).toFixed(1)),
      });

      const destHash = await hashFileXx64(destPath, signal);
      if (srcHash !== destHash) {
        throw new Error(`Lỗi toàn vẹn dữ liệu (XXHash64 không khớp) ở file: ${file.name}`);
      }

      filesCompleted += 1;
      verifiedFiles += 1;
    }

    const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.1);
    emit({
      status: 'completed',
      currentFile: 'Hoàn tất & Verify 100%',
      filesCompleted,
      totalFiles,
      skippedFiles,
      verifiedFiles,
      bytesCopied: totalBytes,
      totalBytes,
      percent: 100,
      speedMBs: Number((totalBytes / (1024 * 1024) / elapsedSec).toFixed(1)),
    });

    activeAbortController = null;
    return {
      stage: req.stage,
      success: true,
      totalFiles,
      copiedFiles: filesCompleted,
      verifiedFiles,
      skippedFiles,
      totalBytes,
      destDir: req.destDir,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isCancelled = message === 'CANCELLED';
    emit({
      status: isCancelled ? 'cancelled' : 'error',
      currentFile: isCancelled ? 'Đã hủy bởi người dùng' : message,
      filesCompleted: 0,
      totalFiles: 0,
      skippedFiles: 0,
      verifiedFiles: 0,
      bytesCopied: 0,
      totalBytes: 0,
      percent: 0,
      speedMBs: 0,
      error: message,
    });
    activeAbortController = null;
    return {
      stage: req.stage,
      success: false,
      totalFiles: 0,
      copiedFiles: 0,
      verifiedFiles: 0,
      skippedFiles: 0,
      totalBytes: 0,
      destDir: req.destDir,
      error: message,
    };
  }
}
