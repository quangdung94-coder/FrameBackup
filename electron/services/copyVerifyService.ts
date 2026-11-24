import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import xxhash from 'xxhash-wasm';
import { detectCopyEngines, runExternalCopyEngine, type CopyEngineId } from './copyEngineService';
import { scanFilesRecursive, type FileEntry } from './diskService';

export type DateFilterMode = 'all' | 'target-only' | 'split';

export interface CopyVerifyRequest {
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  sourceDir: string;
  destDir: string;
  targetDate?: string;
  overnightMode?: boolean;
  dateFilterMode?: DateFilterMode;
  engine?: CopyEngineId;
}

export interface CopyProgressEvent {
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  status: 'scanning' | 'copying' | 'verifying' | 'completed' | 'cancelled' | 'error';
  currentFile: string;
  filesCompleted: number;
  totalFiles: number;
  skippedFiles: number;
  resumedFiles: number;
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
  resumedFiles: number;
  verifiedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  destDir: string;
  usedEngine: CopyEngineId;
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

/**
 * Prevents catastrophic self-copying (destDir === sourceDir or destDir nested inside sourceDir).
 */
function assertNonOverlappingDirs(sourceDir: string, destDir: string): void {
  const normSrc = path.resolve(sourceDir);
  const normDest = path.resolve(destDir);
  const cmpSrc = process.platform === 'win32' ? normSrc.toLowerCase() : normSrc;
  const cmpDest = process.platform === 'win32' ? normDest.toLowerCase() : normDest;
  const sep = path.sep;

  if (cmpSrc === cmpDest) {
    throw new Error('Thư mục đích không được trùng với thư mục nguồn!');
  }
  const srcPrefix = cmpSrc.endsWith(sep) ? cmpSrc : `${cmpSrc}${sep}`;
  if (cmpDest.startsWith(srcPrefix)) {
    throw new Error('Thư mục đích không được nằm bên trong thư mục nguồn (tránh vòng lặp vô hạn)!');
  }
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

async function copyFileAtomicAndHashSource(
  srcPath: string,
  destPath: string,
  mtimeMs: number,
  signal: AbortSignal,
  onChunk: (bytes: number) => void
): Promise<string> {
  const api = await getXxhash();
  const hasher = api.create64();
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  // Write to temp .fbpart file first so cancel/disconnect never leaves a corrupt partial file
  const tmpDest = `${destPath}.fbpart`;

  try {
    const srcHash = await new Promise<string>((resolve, reject) => {
      const reader = fs.createReadStream(srcPath, { highWaterMark: 4 * 1024 * 1024 });
      const writer = fs.createWriteStream(tmpDest, { highWaterMark: 4 * 1024 * 1024 });

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

    // Preserve original mtime before verification & atomic rename
    const mtimeDate = new Date(mtimeMs);
    await fsp.utimes(tmpDest, mtimeDate, mtimeDate).catch(() => {});

    // Verify XXHash64 of tmpDest against source stream hash
    const destHash = await hashFileXx64(tmpDest, signal);
    if (srcHash !== destHash) {
      throw new Error(`Lỗi toàn vẹn dữ liệu (XXHash64 không khớp) ở file: ${path.basename(destPath)}`);
    }

    // Atomic promotion to final filename
    await fsp.rename(tmpDest, destPath);
    return srcHash;
  } catch (err) {
    // Always remove incomplete .fbpart file on error or cancellation
    await fsp.unlink(tmpDest).catch(() => {});
    throw err;
  }
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
    assertNonOverlappingDirs(req.sourceDir, req.destDir);

    emit({
      status: 'scanning',
      currentFile: 'Đang quét danh sách file & metadata...',
      filesCompleted: 0,
      totalFiles: 0,
      skippedFiles: 0,
      resumedFiles: 0,
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
    let resumedFiles = 0;
    let verifiedFiles = 0;
    const startedAt = Date.now();
    let lastEmitAt = 0;

    await fsp.mkdir(req.destDir, { recursive: true });

    // Check if an external copy engine can be safely used without losing folder structure or bypassing Date Guard
    const requestedEngine = req.engine ?? 'builtin';
    const hasNestedSubdirs = filesToCopy.some((f) => f.relativePath.includes(path.sep));
    const externalWouldFlattenFilteredSubdirs =
      skippedFiles > 0 && hasNestedSubdirs && (requestedEngine === 'teracopy' || requestedEngine === 'fastcopy');

    const canUseExternal =
      requestedEngine !== 'builtin' &&
      totalFiles > 0 &&
      !(req.stage === 'card-to-drive1' && filterMode === 'split') &&
      !(skippedFiles > 0 && (requestedEngine === 'robocopy' || requestedEngine === 'ditto')) &&
      !externalWouldFlattenFilteredSubdirs;

    if (canUseExternal) {
      const detected = await detectCopyEngines();
      const found = detected.find((e) => e.id === requestedEngine && e.available && e.executablePath);
      if (found && found.executablePath) {
        emit({
          status: 'copying',
          currentFile: `Đang chạy trình copy ngoài: ${found.name}...`,
          filesCompleted: 0,
          totalFiles,
          skippedFiles,
          resumedFiles: 0,
          verifiedFiles: 0,
          bytesCopied: 0,
          totalBytes,
          percent: 15,
          speedMBs: 0,
        });

        await runExternalCopyEngine({
          engine: requestedEngine,
          executablePath: found.executablePath,
          sourceDir: req.sourceDir,
          destDir: req.destDir,
          filteredFilePaths: skippedFiles > 0 ? filesToCopy.map((f) => f.fullPath) : undefined,
          relativeFilePaths: skippedFiles > 0 ? filesToCopy.map((f) => f.relativePath.replace(/\\/g, '/')) : undefined,
          signal,
        });

        const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.1);
        emit({
          status: 'completed',
          currentFile: `Hoàn tất bằng ${found.name}`,
          filesCompleted: totalFiles,
          totalFiles,
          skippedFiles,
          resumedFiles: 0,
          verifiedFiles: totalFiles,
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
          copiedFiles: totalFiles,
          resumedFiles: 0,
          verifiedFiles: totalFiles,
          skippedFiles,
          totalBytes,
          destDir: req.destDir,
          usedEngine: requestedEngine,
        };
      }
    }

    // Built-in atomic streaming copy + Smart Resume + XXHash64 verification
    for (const file of filesToCopy) {
      if (signal.aborted) throw new Error('CANCELLED');

      let destPath: string;
      if (req.stage === 'card-to-drive1' && filterMode === 'split') {
        const folderDate = formatDateKey(file.shotTimeMs).replace(/-/g, '.');
        destPath = path.join(req.destDir, folderDate, file.relativePath);
      } else {
        destPath = path.join(req.destDir, file.relativePath);
      }

      // Smart Resume: if destination already exists with same size AND matching XXHash64, skip re-copy
      let alreadyIdentical = false;
      try {
        const existingStat = await fsp.stat(destPath);
        if (existingStat.isFile() && existingStat.size === file.sizeBytes) {
          emit({
            status: 'verifying',
            currentFile: `Kiểm tra file đã có (Resume): ${file.name}`,
            filesCompleted,
            totalFiles,
            skippedFiles,
            resumedFiles,
            verifiedFiles,
            bytesCopied,
            totalBytes,
            percent: totalBytes > 0 ? Math.min(99, Math.round((bytesCopied / totalBytes) * 100)) : 0,
            speedMBs: Number((bytesCopied / (1024 * 1024) / Math.max((Date.now() - startedAt) / 1000, 0.1)).toFixed(1)),
          });
          const [srcHash, dstHash] = await Promise.all([
            hashFileXx64(file.fullPath, signal),
            hashFileXx64(destPath, signal),
          ]);
          if (srcHash === dstHash) {
            alreadyIdentical = true;
            bytesCopied += file.sizeBytes;
            resumedFiles += 1;
          }
        }
      } catch {
        // Destination doesn't exist yet -> proceed with copy
      }

      if (!alreadyIdentical) {
        await copyFileAtomicAndHashSource(file.fullPath, destPath, file.mtimeMs, signal, (chunkBytes) => {
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
              resumedFiles,
              verifiedFiles,
              bytesCopied,
              totalBytes,
              percent,
              speedMBs,
            });
          }
        });
      }

      filesCompleted += 1;
      verifiedFiles += 1;
    }

    const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.1);
    emit({
      status: 'completed',
      currentFile: resumedFiles > 0 ? `Hoàn tất & Verify 100% (Resume ${resumedFiles} files)` : 'Hoàn tất & Verify 100%',
      filesCompleted,
      totalFiles,
      skippedFiles,
      resumedFiles,
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
      copiedFiles: filesCompleted - resumedFiles,
      resumedFiles,
      verifiedFiles,
      skippedFiles,
      totalBytes,
      destDir: req.destDir,
      usedEngine: 'builtin',
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
      resumedFiles: 0,
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
      resumedFiles: 0,
      verifiedFiles: 0,
      skippedFiles: 0,
      totalBytes: 0,
      destDir: req.destDir,
      usedEngine: req.engine ?? 'builtin',
      error: message,
    };
  }
}
