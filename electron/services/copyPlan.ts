import fsp from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '../lib/errors';
import { isTimestampMatchingTargetDate, shootDateKey } from '../shared/dates';
import type { CopyConflict, CopyEngineId, CopyPreflightResult, CopyVerifyRequest } from '../shared/types';
import { DATA_SCAN_OPTIONS, scanFilesRecursive, type FileEntry } from './diskService';

export const samePath = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

/** "C0001.MP4" -> "C0001 (2).MP4" */
export function withCopySuffix(filePath: string, n: number): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`);
}

/**
 * Prevents catastrophic self-copying (destDir === sourceDir or destDir nested inside sourceDir).
 */
export function assertNonOverlappingDirs(sourceDir: string, destDir: string): void {
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

export async function statOrNull(p: string) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

/** Dung lượng trống của ổ chứa `dir` (dò lên thư mục cha gần nhất đang tồn tại). -1 nếu không đọc được. */
export async function getFreeBytes(dir: string): Promise<number> {
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

export interface CopyPlan {
  files: FileEntry[];
  /** Đích mong muốn của từng file (theo fullPath nguồn). */
  preferredDest: Map<string, string>;
  skippedFiles: number;
  /** Số file bị trùng tên ngay trong lượt chép và đã được đặt tên "(2)". */
  batchDuplicateNames: number;
  filterMode: NonNullable<CopyVerifyRequest['dateFilterMode']>;
  isFilteredOrSelected: boolean;
}

/** Lên kế hoạch chép: lọc file, ghép sidecar XML, tính đường dẫn đích (không ghi gì). */
export async function planCopy(req: CopyVerifyRequest): Promise<CopyPlan> {
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

export async function collectConflicts(plan: CopyPlan): Promise<{ conflicts: CopyConflict[]; requiredBytes: number }> {
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

/** Engine ngoài chép được đúng cấu trúc đích mà app đã tính hay không. */
export function externalEngineFits(engine: CopyEngineId, req: CopyVerifyRequest, plan: CopyPlan): boolean {
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
