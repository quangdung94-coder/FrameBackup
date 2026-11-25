import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { errorMessage, isCancelledMessage, cancelledError } from '../lib/errors';
import { getXxhash, hashFileXx64, STREAM_CHUNK_BYTES } from '../lib/hash';
import { createJobPool } from '../lib/jobSlot';
import { createThrottle } from '../lib/progress';
import { isTimestampMatchingTargetDate, shootDateKey } from '../shared/dates';
import { formatBytes } from '../shared/format';
import { calcPercent, calcSpeedMBs } from '../shared/format';
import type {
  ConflictPolicy,
  CopyConflict,
  CopyEngineId,
  CopyPreflightResult,
  CopyProgressEvent,
  CopyVerifyRequest,
  CopyVerifySummary,
} from '../shared/types';
import { statsOf } from '../shared/report';
import { detectCopyEngines, runExternalCopyEngine } from './copyEngineService';
import { forgetHash, hashWithLedger, recordCardIngest, recordDrive2Backup, rememberHash } from './verifyLedger';
import { DATA_SCAN_OPTIONS, isIgnoredSystemName, scanFilesRecursive, type FileEntry } from './diskService';

export type { CopyProgressEvent, CopyVerifyRequest, CopyVerifySummary, DateFilterMode } from '../shared/types';

const samePath = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

const copyJob = createJobPool();

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

// ---------------------------------------------------------------------------
// Lên kế hoạch chép: lọc file, ghép sidecar XML, tính đường dẫn đích (không ghi gì)
// ---------------------------------------------------------------------------

interface CopyPlan {
  files: FileEntry[];
  /** Đích mong muốn của từng file (theo fullPath nguồn). */
  preferredDest: Map<string, string>;
  skippedFiles: number;
  /** Số file bị trùng tên ngay trong lượt chép và đã được đặt tên "(2)". */
  batchDuplicateNames: number;
  filterMode: NonNullable<CopyVerifyRequest['dateFilterMode']>;
  isFilteredOrSelected: boolean;
}

/** "C0001.MP4" -> "C0001 (2).MP4" */
function withCopySuffix(filePath: string, n: number): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`);
}

async function planCopy(req: CopyVerifyRequest): Promise<CopyPlan> {
  const isCardStage = req.stage === 'card-to-drive1';
  const allFiles = await scanFilesRecursive(req.sourceDir, isCardStage, DATA_SCAN_OPTIONS);
  const filterMode = req.dateFilterMode ?? 'all';
  const selectedList =
    req.selectedFilePaths && req.selectedFilePaths.length > 0
      ? req.selectedFilePaths.map((p) => path.resolve(p).toLowerCase())
      : null;
  const isPathSelected = (fullPath: string): boolean => {
    if (!selectedList) return true;
    const norm = path.resolve(fullPath).toLowerCase();
    return selectedList.some((sel) => norm === sel || norm.startsWith(sel.endsWith(path.sep) ? sel : `${sel}${path.sep}`));
  };
  const allowedExtSet =
    req.allowedExtensions && req.allowedExtensions.length > 0
      ? new Set(req.allowedExtensions.map((e) => e.toLowerCase()))
      : null;

  let skippedFiles = 0;
  const files: FileEntry[] = [];
  const selectedStems = new Set<string>();

  // First pass: collect primary matching files
  for (const f of allFiles) {
    if (selectedList) {
      if (!isPathSelected(f.fullPath)) {
        skippedFiles += 1;
        continue;
      }
    } else if (allowedExtSet && isCardStage) {
      if (!allowedExtSet.has(f.extension.toLowerCase())) {
        skippedFiles += 1;
        continue;
      }
    }

    if (
      !selectedList &&
      isCardStage &&
      filterMode === 'target-only' &&
      !isTimestampMatchingTargetDate(f.shotTimeMs, req.targetDate, req.overnightMode ?? true)
    ) {
      skippedFiles += 1;
      continue;
    }
    files.push(f);
    if (f.mediaType === 'video') {
      selectedStems.add(path.parse(f.name).name.toLowerCase());
    }
  }

  // Second pass: tự kèm sidecar XML của Sony/máy quay (C0001M01.XML). Dùng path.parse để chạy cả đuôi .XML in hoa.
  if (isCardStage && req.includeSidecarXml && selectedStems.size > 0) {
    const alreadyQueued = new Set(files.map((f) => f.fullPath.toLowerCase()));
    for (const f of allFiles) {
      if (alreadyQueued.has(f.fullPath.toLowerCase())) continue;
      if (f.extension.toLowerCase() !== '.xml') continue;
      const xmlBase = path.parse(f.name).name.toLowerCase();
      const matchesVideo = selectedStems.has(xmlBase) || (xmlBase.endsWith('m01') && selectedStems.has(xmlBase.slice(0, -3)));
      if (matchesVideo) {
        files.push(f);
        alreadyQueued.add(f.fullPath.toLowerCase());
      }
    }
  }

  // Đích mong muốn. Thẻ -> Ổ 1: làm phẳng (không tạo lại PRIVATE/M4ROOT/CLIP).
  // Hai file trùng tên trong cùng lượt (100MSDCF & 101MSDCF) => file sau thành "tên (2)", không bao giờ đè nhau.
  const preferredDest = new Map<string, string>();
  const claimed = new Set<string>();
  let batchDuplicateNames = 0;
  for (const f of files) {
    let dest: string;
    if (isCardStage) {
      const baseName = path.basename(f.fullPath);
      dest =
        filterMode === 'split'
          ? path.join(
              req.destDir,
              shootDateKey(f.shotTimeMs, req.targetDate, req.overnightMode ?? true).replace(/-/g, '.'),
              baseName
            )
          : path.join(req.destDir, baseName);
    } else {
      dest = path.join(req.destDir, f.relativePath);
    }
    if (claimed.has(samePath(dest))) {
      batchDuplicateNames += 1;
      let n = 2;
      while (claimed.has(samePath(withCopySuffix(dest, n)))) n += 1;
      dest = withCopySuffix(dest, n);
    }
    claimed.add(samePath(dest));
    preferredDest.set(f.fullPath, dest);
  }

  return {
    files,
    preferredDest,
    skippedFiles,
    batchDuplicateNames,
    filterMode,
    isFilteredOrSelected: Boolean(selectedList) || skippedFiles > 0,
  };
}

async function statOrNull(p: string) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

/** Dung lượng trống của ổ chứa `dir` (dò lên thư mục cha gần nhất đang tồn tại). -1 nếu không đọc được. */
async function getFreeBytes(dir: string): Promise<number> {
  let current = path.resolve(dir);
  for (;;) {
    try {
      const st = await fsp.statfs(current);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return -1;
      current = parent;
    }
  }
}

async function collectConflicts(plan: CopyPlan): Promise<{ conflicts: CopyConflict[]; requiredBytes: number }> {
  const conflicts: CopyConflict[] = [];
  let requiredBytes = 0;
  for (const f of plan.files) {
    const dest = plan.preferredDest.get(f.fullPath)!;
    const st = await statOrNull(dest);
    if (!st) {
      requiredBytes += f.sizeBytes;
      continue;
    }
    const sameSize = st.isFile() && st.size === f.sizeBytes;
    if (!sameSize) requiredBytes += f.sizeBytes;
    conflicts.push({
      name: path.basename(dest),
      sourcePath: f.fullPath,
      destPath: dest,
      sourceBytes: f.sizeBytes,
      destBytes: st.isFile() ? st.size : 0,
      sameSize,
    });
  }
  return { conflicts, requiredBytes };
}

/** Kiểm tra trước khi chép: số file, dung lượng cần, file trùng tên ở đích. Không ghi gì. */
export async function preflightCopy(req: CopyVerifyRequest): Promise<CopyPreflightResult> {
  try {
    assertNonOverlappingDirs(req.sourceDir, req.destDir);
    const plan = await planCopy(req);
    const { conflicts, requiredBytes } = await collectConflicts(plan);
    return {
      ok: true,
      totalFiles: plan.files.length,
      totalBytes: plan.files.reduce((s, f) => s + f.sizeBytes, 0),
      requiredBytes,
      freeBytes: await getFreeBytes(req.destDir),
      conflicts,
      batchDuplicateNames: plan.batchDuplicateNames,
    };
  } catch (err) {
    return {
      ok: false,
      totalFiles: 0,
      totalBytes: 0,
      requiredBytes: 0,
      freeBytes: -1,
      conflicts: [],
      batchDuplicateNames: 0,
      error: errorMessage(err),
    };
  }
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

/** Engine ngoài chép được đúng cấu trúc đích mà app đã tính hay không. */
function externalEngineFits(engine: CopyEngineId, req: CopyVerifyRequest, plan: CopyPlan): boolean {
  if (engine === 'builtin' || plan.files.length === 0) return false;
  if (plan.batchDuplicateNames > 0) return false; // cần đổi tên "(2)" => chỉ Built-in làm được
  if (req.stage === 'card-to-drive1') {
    if (plan.filterMode === 'split') return false;
    // Làm phẳng theo danh sách file: TeraCopy / FastCopy / rsync --no-relative. Robocopy & ditto chép cả cây thư mục.
    return engine === 'teracopy' || engine === 'fastcopy' || engine === 'rsync';
  }
  const hasNestedSubdirs = plan.files.some((f) => f.relativePath.includes(path.sep));
  if (!plan.isFilteredOrSelected) return true;
  if (engine === 'robocopy' || engine === 'ditto') return false;
  if ((engine === 'teracopy' || engine === 'fastcopy') && hasNestedSubdirs) return false;
  return true;
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
