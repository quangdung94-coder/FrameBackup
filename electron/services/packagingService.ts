import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { path7za } from '7zip-bin';
import { scanFilesRecursive } from './diskService';

export type PackMode = 'video-raw-smart' | 'none' | 'zip-store' | '7z';

export interface PackageRequest {
  projectName: string;
  sourceDir: string;
  packMode: PackMode;
}

export interface PackageProgressEvent {
  status: 'scanning' | 'packing' | 'completed' | 'cancelled' | 'error';
  percent: number;
  message: string;
}

export interface PackageResult {
  success: boolean;
  packMode: PackMode;
  archivePaths: string[];
  looseFilePaths: string[];
  totalOutputBytes: number;
  error?: string;
}

let activePackAbort: AbortController | null = null;

export function cancelPackaging(): boolean {
  if (activePackAbort) {
    activePackAbort.abort();
    activePackAbort = null;
    return true;
  }
  return false;
}

async function run7za(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  onPercent: (pct: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(path7za, args, { cwd, windowsHide: true });

    const onAbort = () => {
      child.kill();
      reject(new Error('CANCELLED'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    const parseProgress = (chunk: Buffer | string) => {
      const text = chunk.toString();
      const matches = text.match(/(\d{1,3})%/g);
      if (matches && matches.length > 0) {
        const last = parseInt(matches[matches.length - 1], 10);
        if (!Number.isNaN(last)) onPercent(Math.min(99, last));
      }
    };

    child.stdout?.on('data', parseProgress);
    child.stderr?.on('data', parseProgress);

    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`7za kết thúc với mã lỗi ${code}`));
    });
  });
}

export async function packageForDrive(
  req: PackageRequest,
  onProgress: (ev: PackageProgressEvent) => void
): Promise<PackageResult> {
  if (activePackAbort) activePackAbort.abort();
  const controller = new AbortController();
  activePackAbort = controller;
  const { signal } = controller;

  const safeProj = req.projectName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'FrameBackup_Show';
  const stagingDir = path.join(os.tmpdir(), 'framebackup_staging', safeProj);
  await fsp.mkdir(stagingDir, { recursive: true });

  let tempListFile: string | null = null;

  try {
    onProgress({ status: 'scanning', percent: 5, message: 'Đang phân loại Video / Ảnh để đóng gói...' });
    const allFiles = await scanFilesRecursive(req.sourceDir, false);

    if (req.packMode === 'none') {
      const totalBytes = allFiles.reduce((s, f) => s + f.sizeBytes, 0);
      onProgress({ status: 'completed', percent: 100, message: 'Không nén — Up nguyên cấu trúc thư mục' });
      activePackAbort = null;
      return {
        success: true,
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
        await fsp.unlink(archivePath).catch(() => {});
        tempListFile = path.join(os.tmpdir(), `fb_pack_${Date.now()}.txt`);
        await fsp.writeFile(
          tempListFile,
          photoOrRaw.map((f) => f.relativePath).join('\n'),
          'utf8'
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

      activePackAbort = null;
      return {
        success: true,
        packMode: 'video-raw-smart',
        archivePaths,
        looseFilePaths: otherFiles.map((f) => f.fullPath),
        totalOutputBytes,
      };
    }

    // 'zip-store' or '7z' for entire folder
    const is7z = req.packMode === '7z';
    const archivePath = path.join(stagingDir, is7z ? `${safeProj}.7z` : `${safeProj}_Store.zip`);
    await fsp.unlink(archivePath).catch(() => {});

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

    const st = await fsp.stat(archivePath);
    onProgress({
      status: 'completed',
      percent: 100,
      message: `Hoàn tất đóng gói (${path.basename(archivePath)})`,
    });

    activePackAbort = null;
    return {
      success: true,
      packMode: req.packMode,
      archivePaths: [archivePath],
      looseFilePaths: [],
      totalOutputBytes: st.size,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isCancelled = message === 'CANCELLED';
    onProgress({
      status: isCancelled ? 'cancelled' : 'error',
      percent: 0,
      message: isCancelled ? 'Đã hủy đóng gói' : message,
    });
    activePackAbort = null;
    return {
      success: false,
      packMode: req.packMode,
      archivePaths: [],
      looseFilePaths: [],
      totalOutputBytes: 0,
      error: message,
    };
  } finally {
    if (tempListFile) {
      await fsp.unlink(tempListFile).catch(() => {});
    }
  }
}
