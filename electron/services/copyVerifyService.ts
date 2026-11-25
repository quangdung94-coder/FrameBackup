import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { errorMessage, isCancelledMessage, cancelledError } from '../lib/errors';
import { getXxhash, hashFileXx64, STREAM_CHUNK_BYTES } from '../lib/hash';
import { createJobPool } from '../lib/jobSlot';
import { createThrottle } from '../lib/progress';
import { formatBytes } from '../shared/format';
import { calcPercent, calcSpeedMBs } from '../shared/format';
import type {
  ConflictPolicy,
  CopyProgressEvent,
  CopyVerifyRequest,
  CopyVerifySummary,
} from '../shared/types';
import { statsOf } from '../shared/report';
import { detectCopyEngines, runExternalCopyEngine } from './copyEngineService';
import {
  assertNonOverlappingDirs,
  collectConflicts,
  externalEngineFits,
  getFreeBytes,
  planCopy,
  samePath,
  statOrNull,
  withCopySuffix,
  type CopyPlan,
} from './copyPlan';
import { forgetHash, hashWithLedger, recordCardIngest, recordDrive2Backup, rememberHash } from './verifyLedger';
import { isIgnoredSystemName, type FileEntry } from './diskService';

export type { CopyProgressEvent, CopyVerifyRequest, CopyVerifySummary, DateFilterMode } from '../shared/types';
export { preflightCopy } from './copyPlan';

const copyJob = createJobPool();

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
  forgetHash(destPath);

  try {
    const srcHash = await new Promise<string>((resolve, reject) => {
      const reader = fs.createReadStream(srcPath, { highWaterMark: STREAM_CHUNK_BYTES });
      const writer = fs.createWriteStream(tmpDest, { highWaterMark: STREAM_CHUNK_BYTES });

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        reader.destroy();
        writer.destroy();
        reject(cancelledError());
      };
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

      // Kiểm tra hủy SAU khi đã gắn handler lỗi (tránh văng main process — lỗi D16)
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
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
    // Ghi sổ verify: lần sau gặp lại 2 file này (chưa đổi) thì không phải đọc lại để so hash
    try {
      const srcSt = await fsp.stat(srcPath);
      rememberHash(srcPath, srcSt.size, srcSt.mtimeMs, srcHash);
      const dstSt = await fsp.stat(destPath);
      rememberHash(destPath, dstSt.size, dstSt.mtimeMs, srcHash);
    } catch {
      // bỏ qua — chỉ là bộ nhớ đệm
    }
    return srcHash;
  } catch (err) {
    // Always remove incomplete .fbpart file on error or cancellation
    await fsp.unlink(tmpDest).catch(() => {});
    throw err;
  }
}

export function cancelActiveCopy(jobId?: string): boolean {
  return copyJob.cancel(jobId);
}

type DestDecision =
  | { action: 'copy'; destPath: string; renamed: boolean }
  | { action: 'resume'; destPath: string }
  | { action: 'skip'; destPath: string };

/**
 * Chọn đích thật cho 1 file:
 * - chưa có => chép
 * - có, giống hệt (dung lượng + XXHash64) => Smart Resume
 * - có, khác nội dung => theo policy: keep-both (đặt "tên (n)"), skip, overwrite.
 */
async function resolveDestination(
  file: FileEntry,
  preferred: string,
  policy: ConflictPolicy,
  claimed: Set<string>,
  signal: AbortSignal,
  onVerifyExisting: () => void,
  onLedgerHit: () => void
): Promise<DestDecision> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? preferred : withCopySuffix(preferred, n);
    if (n > 1 && claimed.has(samePath(candidate))) continue;
    const st = await statOrNull(candidate);
    if (!st) {
      if (n > 1) claimed.add(samePath(candidate));
      return { action: 'copy', destPath: candidate, renamed: n > 1 };
    }
    if (st.isFile() && st.size === file.sizeBytes) {
      onVerifyExisting();
      const [src, dst] = await Promise.all([hashWithLedger(file.fullPath, signal), hashWithLedger(candidate, signal)]);
      if (src.hash === dst.hash) {
        if (src.hit && dst.hit) onLedgerHit();
        return { action: 'resume', destPath: candidate };
      }
    }
    // Đích khác nội dung
    if (policy === 'overwrite' && st.isFile()) return { action: 'copy', destPath: candidate, renamed: n > 1 };
    if (policy === 'skip') return { action: 'skip', destPath: candidate };
    // keep-both: thử tên tiếp theo
  }
  throw new Error(`Không tìm được tên trống cho file: ${file.name}`);
}

/** File .fbpart sót lại (lần chép trước bị tắt ngang / mất điện). */
async function findPartFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 12 || out.length > 500) return out;
  let dirents;
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    if (d.isFile() && d.name.endsWith('.fbpart')) out.push(full);
    else if (d.isDirectory() && !isIgnoredSystemName(d.name)) await findPartFiles(full, depth + 1, out);
  }
  return out;
}

/** Ghi sổ verify khi chép trọn 1 lượt (không phải chỉ vài file đang chọn). */
function recordStageSuccess(req: CopyVerifyRequest, plan: CopyPlan) {
  if (req.selectedFilePaths && req.selectedFilePaths.length > 0) return;
  if (req.stage === 'card-to-drive1') {
    recordCardIngest(req.destDir, { ...statsOf(plan.files), at: Date.now(), sourceDir: req.sourceDir, hashVerified: true });
  } else {
    recordDrive2Backup(req.sourceDir, { at: Date.now(), destDir: req.destDir, files: plan.files.length });
  }
}

export async function runCopyAndVerify(
  req: CopyVerifyRequest,
  onProgress: (ev: CopyProgressEvent) => void
): Promise<CopyVerifySummary> {
  const jobController = copyJob.begin(req.jobId);
  const { signal } = jobController;
  const policy: ConflictPolicy = req.conflictPolicy ?? 'keep-both';

  const emit = (partial: Omit<CopyProgressEvent, 'stage'>) => {
    onProgress({ jobId: req.jobId, stage: req.stage, ...partial });
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

    const plan = await planCopy(req);
    const filesToCopy = plan.files;
    const skippedFiles = plan.skippedFiles;
    const totalBytes = filesToCopy.reduce((sum, f) => sum + f.sizeBytes, 0);
    const totalFiles = filesToCopy.length;
    let bytesCopied = 0;
    let filesCompleted = 0;
    let resumedFiles = 0;
    let verifiedFiles = 0;
    let skippedConflicts = 0;
    let renamedFiles = plan.batchDuplicateNames;
    let ledgerHits = 0;
    const startedAt = Date.now();
    const shouldEmit = createThrottle(120);

    // Chặn sớm khi ổ đích không đủ chỗ (trước đây chỉ cảnh báo, chép dở mới lỗi)
    const { conflicts, requiredBytes } = await collectConflicts(plan);
    const freeBytes = await getFreeBytes(req.destDir);
    if (freeBytes >= 0 && requiredBytes > freeBytes) {
      throw new Error(
        `Ổ đích không đủ dung lượng: cần thêm ${formatBytes(requiredBytes)}, chỉ còn trống ${formatBytes(freeBytes)}.`
      );
    }

    await fsp.mkdir(req.destDir, { recursive: true });

    // Engine ngoài: app tự tính danh sách file + đích, engine chỉ việc chép; xong app tự verify XXHash64 từng file.
    const requestedEngine = req.engine ?? 'builtin';
    const destAlreadyHasFiles = conflicts.length > 0 && policy !== 'overwrite';
    if (!destAlreadyHasFiles && externalEngineFits(requestedEngine, req, plan)) {
      const detected = await detectCopyEngines();
      const found = detected.find((e) => e.id === requestedEngine && e.available && e.executablePath);
      if (found && found.executablePath && requestedEngine !== 'builtin') {
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

        const useList = req.stage === 'card-to-drive1' || plan.isFilteredOrSelected;
        await runExternalCopyEngine({
          engine: requestedEngine,
          executablePath: found.executablePath,
          sourceDir: req.sourceDir,
          destDir: req.destDir,
          filteredFilePaths: useList ? filesToCopy.map((f) => f.fullPath) : undefined,
          relativeFilePaths: useList ? filesToCopy.map((f) => f.relativePath.replace(/\\/g, '/')) : undefined,
          flatten: req.stage === 'card-to-drive1',
          signal,
        });

        // Tự verify sau engine ngoài: đủ file, đúng dung lượng, XXHash64 khớp nguồn.
        let checkedBytes = 0;
        const verifyStartedAt = Date.now();
        for (const file of filesToCopy) {
          if (signal.aborted) throw cancelledError();
          const dest = plan.preferredDest.get(file.fullPath)!;
          emit({
            status: 'verifying',
            currentFile: `Verify XXHash64 sau ${found.name}: ${file.name}`,
            filesCompleted: verifiedFiles,
            totalFiles,
            skippedFiles,
            resumedFiles: 0,
            verifiedFiles,
            bytesCopied: checkedBytes,
            totalBytes,
            percent: calcPercent(checkedBytes, totalBytes),
            speedMBs: calcSpeedMBs(checkedBytes, verifyStartedAt),
          });
          const st = await statOrNull(dest);
          if (!st || !st.isFile()) throw new Error(`${found.name} báo xong nhưng thiếu file ở đích: ${file.name}`);
          if (st.size !== file.sizeBytes) throw new Error(`${found.name} chép sai dung lượng: ${file.name}`);
          // Đích vừa được engine ngoài ghi => luôn đọc lại đích, không dùng sổ
          forgetHash(dest);
          const [a, b] = await Promise.all([hashWithLedger(file.fullPath, signal), hashFileXx64(dest, signal)]);
          if (a.hash !== b) throw new Error(`Lỗi toàn vẹn dữ liệu (XXHash64 không khớp) sau ${found.name}: ${file.name}`);
          rememberHash(dest, st.size, st.mtimeMs, b);
          verifiedFiles += 1;
          checkedBytes += file.sizeBytes;
        }

        emit({
          status: 'completed',
          currentFile: `Hoàn tất bằng ${found.name} + Verify XXHash64 100%`,
          filesCompleted: totalFiles,
          totalFiles,
          skippedFiles,
          resumedFiles: 0,
          verifiedFiles,
          bytesCopied: totalBytes,
          totalBytes,
          percent: 100,
          speedMBs: calcSpeedMBs(totalBytes, startedAt),
        });

        recordStageSuccess(req, plan);
        copyJob.release(req.jobId, jobController);
        return {
          stage: req.stage,
          success: true,
          byType: statsOf(filesToCopy).byType,
          totalFiles,
          copiedFiles: totalFiles,
          resumedFiles: 0,
          verifiedFiles,
          skippedFiles,
          totalBytes,
          destDir: req.destDir,
          usedEngine: requestedEngine,
          renamedFiles: 0,
          skippedConflicts: 0,
          orphanPartFiles: await findPartFiles(req.destDir),
        };
      }
    }

    // Built-in atomic streaming copy + Smart Resume + XXHash64 verification
    const claimed = new Set<string>(Array.from(plan.preferredDest.values()).map(samePath));
    for (const file of filesToCopy) {
      if (signal.aborted) throw cancelledError();

      const decision = await resolveDestination(
        file,
        plan.preferredDest.get(file.fullPath)!,
        policy,
        claimed,
        signal,
        () =>
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
            percent: calcPercent(bytesCopied, totalBytes),
            speedMBs: calcSpeedMBs(bytesCopied, startedAt),
          }),
        () => {
          ledgerHits += 1;
        }
      );

      if (decision.action === 'resume') {
        bytesCopied += file.sizeBytes;
        resumedFiles += 1;
        verifiedFiles += 1;
      } else if (decision.action === 'skip') {
        bytesCopied += file.sizeBytes;
        skippedConflicts += 1;
      } else {
        if (decision.renamed) renamedFiles += 1;
        await copyFileAtomicAndHashSource(file.fullPath, decision.destPath, file.mtimeMs, signal, (chunkBytes) => {
          bytesCopied += chunkBytes;
          const now = Date.now();
          if (shouldEmit(now)) {
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
              percent: calcPercent(bytesCopied, totalBytes),
              speedMBs: calcSpeedMBs(bytesCopied, startedAt, now),
            });
          }
        });
        verifiedFiles += 1;
      }
      filesCompleted += 1;
    }

    const notes = [
      resumedFiles > 0 ? `Resume ${resumedFiles}` : '',
      renamedFiles > 0 ? `đổi tên ${renamedFiles} file trùng` : '',
      skippedConflicts > 0 ? `bỏ qua ${skippedConflicts} file trùng tên` : '',
    ].filter(Boolean);
    emit({
      status: 'completed',
      currentFile: `Hoàn tất & Verify 100%${notes.length ? ` (${notes.join(', ')})` : ''}`,
      filesCompleted,
      totalFiles,
      skippedFiles,
      resumedFiles,
      verifiedFiles,
      bytesCopied: totalBytes,
      totalBytes,
      percent: 100,
      speedMBs: calcSpeedMBs(totalBytes, startedAt),
    });

    recordStageSuccess(req, plan);
    copyJob.release(req.jobId, jobController);
    return {
      stage: req.stage,
      success: true,
      byType: statsOf(filesToCopy).byType,
      ledgerHits,
      totalFiles,
      copiedFiles: filesCompleted - resumedFiles - skippedConflicts,
      resumedFiles,
      verifiedFiles,
      skippedFiles,
      totalBytes,
      destDir: req.destDir,
      usedEngine: 'builtin',
      renamedFiles,
      skippedConflicts,
      orphanPartFiles: await findPartFiles(req.destDir),
    };
  } catch (err) {
    const message = errorMessage(err);
    const isCancelled = isCancelledMessage(message);
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
    copyJob.release(req.jobId, jobController);
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

/** Xoá các file .fbpart sót lại (chỉ nhận đúng đuôi .fbpart để không lỡ xoá file thật). */
export async function deletePartFiles(paths: string[]): Promise<{ ok: boolean; message: string }> {
  let deleted = 0;
  for (const p of paths) {
    if (!p.endsWith('.fbpart')) continue;
    try {
      await fsp.unlink(p);
      deleted += 1;
    } catch {
      // bỏ qua file đã mất / đang khóa
    }
  }
  return { ok: true, message: `Đã xoá ${deleted} file tạm .fbpart sót lại.` };
}
