import fsp from 'node:fs/promises';
import path from 'node:path';
import { path7za as path7zaRaw } from '7zip-bin';
import { resolveUnpackedBinary } from '../lib/binaries';
import { errorMessage, isCancelledMessage } from '../lib/errors';
import { createJobPool } from '../lib/jobSlot';
import { runAbortableProcess } from '../lib/process';
import { osStagingDir, unlinkQuietly, writeTempListFile } from '../lib/tempFiles';
import { toSafeAsciiName } from '../shared/paths';
import type { PackageProgressEvent, PackageRequest, PackageResult } from '../shared/types';
import { listSystemDrives, scanFilesRecursive } from './diskService';

export type { PackMode, PackageProgressEvent, PackageRequest, PackageResult } from '../shared/types';

const path7za = resolveUnpackedBinary(path7zaRaw);
const packJob = createJobPool();

export function cancelPackaging(jobId?: string): boolean {
  return packJob.cancel(jobId);
}

/** Chạy 7za, đọc % từ output (-bsp1) và báo về onPercent (tối đa 99). */
function run7za(args: string[], cwd: string, signal: AbortSignal, onPercent: (pct: number) => void): Promise<void> {
  return runAbortableProcess(path7za, {
    args,
    cwd,
    signal,
    windowsHide: true,
    onOutput: (chunk) => {
      const matches = chunk.toString().match(/(\d{1,3})%/g);
      if (matches && matches.length > 0) {
        const last = parseInt(matches[matches.length - 1], 10);
        if (!Number.isNaN(last)) onPercent(Math.min(99, last));
      }
    },
    formatExitError: (code) => `7za kết thúc với mã lỗi ${code}`,
  });
}

/** Nguồn có nằm trên thẻ nhớ / ổ rời không (khi đó KHÔNG ghi file tạm lên thẻ). */
async function isOnRemovableDrive(dir: string): Promise<boolean> {
  try {
    const drives = await listSystemDrives();
    const resolved = path.resolve(dir).toLowerCase();
    return drives.some((d) => {
      if (!d.isRemovable || !d.mountPath) return false;
      const mount = path.resolve(d.mountPath).toLowerCase();
      return resolved === mount || resolved.startsWith(mount.endsWith(path.sep) ? mount : mount + path.sep);
    });
  } catch {
    return false;
  }
}

/** Kiểm tra file nén sau khi tạo (7za t) — hỏng là dừng, không upload file nén lỗi lên Drive. */
async function testArchive(archivePath: string, cwd: string, signal: AbortSignal, onPercent: (pct: number) => void) {
  await run7za(['t', '-bsp1', archivePath], cwd, signal, onPercent);
}

async function resolveSafePackStagingDir(sourceDir: string, safeProj: string): Promise<string> {
  if (await isOnRemovableDrive(sourceDir)) {
    const tmp = osStagingDir(safeProj);
    await fsp.mkdir(tmp, { recursive: true });
    return tmp;
  }
  // Prefer placing large .zip/.7z staging archives on the SAME drive as sourceDir (Drive 1)
  // as a sibling folder so we never fill up a small C:\ OS drive with 100GB temp archives!
  const resolvedSource = path.resolve(sourceDir);
  const parentOfSource = path.dirname(resolvedSource);
  if (parentOfSource && parentOfSource !== resolvedSource) {
    const sameDriveStaging = path.join(parentOfSource, '.framebackup_pack_tmp', safeProj);
    try {
      await fsp.mkdir(sameDriveStaging, { recursive: true });
      return sameDriveStaging;
    } catch {
      // Fallback to OS temp dir if parent directory is read-only
    }
  }
  const fallback = osStagingDir(safeProj);
  await fsp.mkdir(fallback, { recursive: true });
  return fallback;
}

export async function packageForDrive(
  req: PackageRequest,
  onProgress: (ev: PackageProgressEvent) => void
): Promise<PackageResult> {
  const jobController = packJob.begin(req.jobId);
  const { signal } = jobController;

  const safeProj = toSafeAsciiName(req.projectName);
  const stagingDir = await resolveSafePackStagingDir(req.sourceDir, safeProj);

  let tempListFile: string | null = null;
  let currentArchivePath: string | null = null;

  try {
    onProgress({ status: 'scanning', percent: 5, message: 'Đang phân loại Video / Ảnh để đóng gói...' });
    const allFiles = await scanFilesRecursive(req.sourceDir, false);
    const sourceInfo = { sourceFiles: allFiles.length, sourceBytes: allFiles.reduce((s, f) => s + f.sizeBytes, 0) };

    if (req.packMode === 'none') {
      const totalBytes = allFiles.reduce((s, f) => s + f.sizeBytes, 0);
      onProgress({ status: 'completed', percent: 100, message: 'Không nén — Up nguyên cấu trúc thư mục' });
      packJob.release(req.jobId, jobController);
      return {
        success: true,
        ...sourceInfo,
        packMode: 'none',
        archivePaths: [],
        looseFilePaths: allFiles.map((f) => f.fullPath),
        totalOutputBytes: totalBytes,
      };
    }

    if (req.packMode === 'video-raw-smart') {
      const photoOrRaw = allFiles.filter((f) => f.mediaType === 'photo' || f.mediaType === 'raw');
      const otherFiles = allFiles.filter((f) => f.mediaType !== 'photo' && f.mediaType !== 'raw');
      const archivePaths: string[] = [];

      if (photoOrRaw.length > 0) {
        const archivePath = path.join(stagingDir, `${safeProj}_Photos_Store.zip`);
        currentArchivePath = archivePath;
        await unlinkQuietly(archivePath);
        tempListFile = await writeTempListFile(
          'fb_pack',
          photoOrRaw.map((f) => f.relativePath)
        );

        onProgress({
          status: 'packing',
          percent: 15,
          message: `Đang đóng gói ${photoOrRaw.length} ảnh (Zip Store - không nén)...`,
        });

        await run7za(['a', '-tzip', '-mx=0', '-bsp1', archivePath, `@${tempListFile}`], req.sourceDir, signal, (pct) => {
          onProgress({
            status: 'packing',
            percent: pct,
            message: `Đang đóng gói ${photoOrRaw.length} ảnh (Zip Store): ${pct}%`,
          });
        });
        onProgress({ status: 'packing', percent: 99, message: 'Đang kiểm tra file Zip vừa tạo (7za t)...' });
        await testArchive(archivePath, req.sourceDir, signal, () => {});
        archivePaths.push(archivePath);
      }

      let totalOutputBytes = otherFiles.reduce((s, f) => s + f.sizeBytes, 0);
      for (const ap of archivePaths) {
        const st = await fsp.stat(ap);
        totalOutputBytes += st.size;
      }

      onProgress({
        status: 'completed',
        percent: 100,
        message:
          archivePaths.length > 0
            ? `Xong: ${otherFiles.length} Video lẻ + 1 file Zip Store (${photoOrRaw.length} ảnh)`
            : `Xong: ${otherFiles.length} Video lẻ (không có ảnh cần gom)`,
      });

      packJob.release(req.jobId, jobController);
      return {
        success: true,
        ...sourceInfo,
        packMode: 'video-raw-smart',
        archivePaths,
        looseFilePaths: otherFiles.map((f) => f.fullPath),
        totalOutputBytes,
      };
    }

    // 'zip-store' or '7z' for entire folder
    const is7z = req.packMode === '7z';
    const archivePath = path.join(stagingDir, is7z ? `${safeProj}.7z` : `${safeProj}_Store.zip`);
    currentArchivePath = archivePath;
    await unlinkQuietly(archivePath);

    const args = is7z
      ? ['a', '-t7z', '-mx=5', '-bsp1', archivePath, '.']
      : ['a', '-tzip', '-mx=0', '-bsp1', archivePath, '.'];

    onProgress({
      status: 'packing',
      percent: 10,
      message: is7z ? 'Đang nén 7z tiêu chuẩn...' : 'Đang đóng gói Zip Store toàn bộ thư mục...',
    });

    await run7za(args, req.sourceDir, signal, (pct) => {
      onProgress({
        status: 'packing',
        percent: pct,
        message: `${is7z ? 'Nén 7z' : 'Đóng gói Zip Store'}: ${pct}%`,
      });
    });

    onProgress({ status: 'packing', percent: 99, message: 'Đang kiểm tra file nén vừa tạo (7za t)...' });
    await testArchive(archivePath, req.sourceDir, signal, () => {});

    const st = await fsp.stat(archivePath);
    onProgress({
      status: 'completed',
      percent: 100,
      message: `Hoàn tất đóng gói (${path.basename(archivePath)})`,
    });

    packJob.release(req.jobId, jobController);
    return {
      success: true,
      ...sourceInfo,
      packMode: req.packMode,
      archivePaths: [archivePath],
      looseFilePaths: [],
      totalOutputBytes: st.size,
    };
  } catch (err) {
    await unlinkQuietly(currentArchivePath);
    const message = errorMessage(err);
    const isCancelled = isCancelledMessage(message);
    onProgress({
      status: isCancelled ? 'cancelled' : 'error',
      percent: 0,
      message: isCancelled ? 'Đã hủy đóng gói' : message,
    });
    packJob.release(req.jobId, jobController);
    return {
      success: false,
      packMode: req.packMode,
      archivePaths: [],
      looseFilePaths: [],
      totalOutputBytes: 0,
      error: message,
    };
  } finally {
    await unlinkQuietly(tempListFile);
  }
}
