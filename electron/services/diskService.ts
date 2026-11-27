import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileAsync, runPowerShell } from '../lib/exec';
import type { DateSource, DriveInfo, FileEntry } from '../shared/types';
import { hasEmbeddedShotDate } from './metadataService';
import { cachedShotDate, readShotDateCached } from './shotDateCache';

export type { DriveInfo, FileEntry } from '../shared/types';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mxf', '.mkv', '.avi', '.mts', '.m2ts', '.braw', '.r3d']);
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp', '.tif', '.tiff']);
const RAW_EXTS = new Set(['.arw', '.cr2', '.cr3', '.nef', '.raf', '.dng', '.orf', '.rw2', '.pef']);

export function isIgnoredSystemName(name: string): boolean {
  return (
    name.startsWith('._') ||
    name.endsWith('.fbpart') ||
    name === '.framebackup_pack_tmp' ||
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === 'Desktop.ini' ||
    name === '$RECYCLE.BIN' ||
    name === 'System Volume Information' ||
    name === '.Spotlight-V100' ||
    name === '.Trashes' ||
    name === '.fseventsd'
  );
}

function classifyFile(fileName: string, isDirectory: boolean): { mediaType: FileEntry['mediaType']; extension: string } {
  if (isDirectory) return { mediaType: 'folder', extension: '' };
  const ext = path.extname(fileName).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return { mediaType: 'video', extension: ext };
  if (RAW_EXTS.has(ext)) return { mediaType: 'raw', extension: ext };
  if (PHOTO_EXTS.has(ext)) return { mediaType: 'photo', extension: ext };
  return { mediaType: 'other', extension: ext };
}

/**
 * Runs async tasks with bounded concurrency so scanning thousands of RAW/video files
 * is fast without exhausting OS file descriptors (EMFILE).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const out = await worker(items[idx]);
      if (out !== null) results.push(out);
    }
  }

  const count = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

export async function listSystemDrives(): Promise<DriveInfo[]> {
  if (process.platform === 'win32') {
    return listWindowsDrives();
  }
  return listPosixDrives();
}

async function listWindowsDrives(): Promise<DriveInfo[]> {
  try {
    const psScript = `
      Get-CimInstance Win32_LogicalDisk |
      Where-Object { $_.DriveType -in 2, 3 } |
      Select-Object DeviceID, VolumeName, Size, FreeSpace, DriveType |
      ConvertTo-Json -Compress
    `;
    const { stdout } = await runPowerShell(psScript);
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items
      .filter((d) => d && d.DeviceID)
      .map((d) => {
        const totalBytes = Number(d.Size) || 0;
        const freeBytes = Number(d.FreeSpace) || 0;
        const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
        const volName = (d.VolumeName || '').trim();
        const isRemovable = Number(d.DriveType) === 2;
        return {
          id: d.DeviceID,
          label: volName ? `${volName} (${d.DeviceID})` : `${isRemovable ? 'Removable Card' : 'Local Disk'} (${d.DeviceID})`,
          mountPath: `${d.DeviceID}\\`,
          totalBytes,
          freeBytes,
          usedPercent,
          isRemovable,
        };
      })
      .sort((a, b) => Number(b.isRemovable) - Number(a.isRemovable) || a.id.localeCompare(b.id));
  } catch (err) {
    console.error('[diskService] Failed to list Windows drives:', err);
    return [];
  }
}

async function listPosixDrives(): Promise<DriveInfo[]> {
  try {
    const { stdout } = await execFileAsync('df', ['-kP']);
    const lines = stdout.trim().split('\n').slice(1);
    const drives: DriveInfo[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const totalBytes = (Number(parts[1]) || 0) * 1024;
      const availBytes = (Number(parts[3]) || 0) * 1024;
      const mountPath = parts.slice(5).join(' ');

      const isRoot = mountPath === '/';
      const isVolume = mountPath.startsWith('/Volumes/');
      if (!isRoot && !isVolume) continue;

      const label = isRoot ? 'Macintosh HD (/)' : path.basename(mountPath);
      const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - availBytes) / totalBytes) * 100) : 0;
      drives.push({
        id: mountPath,
        label,
        mountPath,
        totalBytes,
        freeBytes: availBytes,
        usedPercent,
        isRemovable: isVolume,
      });
    }
    return drives.sort((a, b) => Number(b.isRemovable) - Number(a.isRemovable));
  } catch (err) {
    console.error('[diskService] Failed to list POSIX drives:', err);
    return [];
  }
}

/**
 * true = đọc ngày chụp (EXIF / MP4, có nhớ); false = dùng giờ sửa file;
 * 'cached' = chỉ lấy ngày đã nhớ, chưa có thì để 'pending' (danh sách hiện ngay, ngày đọc ngầm sau).
 */
export type MetadataMode = boolean | 'cached';

async function shotDateFor(fullPath: string, stat: { size: number; mtimeMs: number }, mode: MetadataMode) {
  if (mode === true) return readShotDateCached(fullPath, stat.size, stat.mtimeMs);
  if (mode === 'cached') {
    if (!hasEmbeddedShotDate(fullPath)) return { shotTimeMs: stat.mtimeMs, dateSource: 'mtime' as DateSource };
    return cachedShotDate(fullPath, stat.size, stat.mtimeMs) ?? { shotTimeMs: stat.mtimeMs, dateSource: 'pending' as DateSource };
  }
  return { shotTimeMs: stat.mtimeMs, dateSource: 'mtime' as DateSource };
}

export async function listDirectoryEntries(dirPath: string, readMetadata: MetadataMode = true): Promise<FileEntry[]> {
  if (!dirPath) return [];
  try {
    const dirents = (await fs.readdir(dirPath, { withFileTypes: true })).filter((d) => !isIgnoredSystemName(d.name));

    const entries = await mapWithConcurrency(dirents, 12, async (dirent): Promise<FileEntry | null> => {
      const fullPath = path.join(dirPath, dirent.name);
      try {
        const stat = await fs.stat(fullPath);
        const isDir = stat.isDirectory();
        const { mediaType, extension } = classifyFile(dirent.name, isDir);
        const meta = isDir ? { shotTimeMs: stat.mtimeMs, dateSource: 'mtime' as DateSource } : await shotDateFor(fullPath, stat, readMetadata);

        return {
          name: dirent.name,
          relativePath: dirent.name,
          fullPath,
          isDirectory: isDir,
          sizeBytes: isDir ? 0 : stat.size,
          mtimeMs: stat.mtimeMs,
          shotTimeMs: meta.shotTimeMs,
          dateSource: meta.dateSource,
          mediaType,
          extension,
        };
      } catch {
        return null;
      }
    });

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    console.error(`[diskService] Failed to read directory "${dirPath}":`, err);
    return [];
  }
}

const SKIP_OS_ROOT_DIRS = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'appdata',
  'node_modules',
  '.git',
  'applications',
  'library',
  'system',
  'recovery',
  'perflogs',
]);

export interface ScanOptions {
  maxDepth?: number;
  maxFiles?: number;
  /**
   * 'truncate' = dừng ở giới hạn (chỉ dùng cho XEM danh sách).
   * 'throw' = báo lỗi rõ ràng (dùng cho copy / đóng gói / báo cáo — không bao giờ bỏ sót file im lặng).
   */
  onLimit?: 'truncate' | 'throw';
}

/** Giới hạn khi chỉ để hiển thị (tránh treo khi lỡ chọn cả ổ hệ thống). */
export const VIEW_SCAN_OPTIONS: ScanOptions = { maxDepth: 10, maxFiles: 20000, onLimit: 'truncate' };
/** Giới hạn khi xử lý dữ liệu thật: rất lớn, chạm là báo lỗi. */
export const DATA_SCAN_OPTIONS: ScanOptions = { maxDepth: 64, maxFiles: 1_000_000, onLimit: 'throw' };

function isFilesystemRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  return path.parse(resolved).root === resolved;
}

export async function scanFilesRecursive(
  rootDir: string,
  readMetadata: MetadataMode = true,
  options: ScanOptions = DATA_SCAN_OPTIONS
): Promise<FileEntry[]> {
  const maxDepth = options.maxDepth ?? DATA_SCAN_OPTIONS.maxDepth!;
  const maxFiles = options.maxFiles ?? DATA_SCAN_OPTIONS.maxFiles!;
  const throwOnLimit = (options.onLimit ?? 'throw') === 'throw';
  const discoveredFiles: Array<{ name: string; fullPath: string }> = [];
  // Thư mục hệ thống (Windows, Program Files, Library, System...) chỉ bỏ qua khi nằm NGAY GỐC ổ.
  // Thư mục dự án tên "Library" / "System" bên trong Ổ 1 vẫn được sao lưu.
  const skipOsDirsAtTop = isFilesystemRoot(rootDir);

  const limitHit = (what: string) => {
    if (throwOnLimit) {
      throw new Error(
        `Thư mục quá lớn (${what}). Đã dừng để không bỏ sót file — hãy chọn thư mục con cụ thể hơn: ${rootDir}`
      );
    }
  };

  async function collectPaths(currentDir: string, depth: number) {
    if (depth > maxDepth) {
      limitHit(`sâu hơn ${maxDepth} cấp`);
      return;
    }
    if (discoveredFiles.length >= maxFiles) return;
    let dirents;
    try {
      dirents = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      // Thư mục con không đọc được khi xử lý dữ liệu => báo lỗi thay vì bỏ qua im lặng
      if (throwOnLimit && depth > 0) {
        throw new Error(`Không đọc được thư mục: ${currentDir} (${err instanceof Error ? err.message : String(err)})`);
      }
      if (throwOnLimit) throw err;
      return;
    }
    for (const dirent of dirents) {
      if (discoveredFiles.length >= maxFiles) {
        limitHit(`hơn ${maxFiles.toLocaleString('vi-VN')} file`);
        break;
      }
      if (isIgnoredSystemName(dirent.name)) continue;
      if (dirent.isDirectory() && depth === 0 && skipOsDirsAtTop && SKIP_OS_ROOT_DIRS.has(dirent.name.toLowerCase())) {
        continue;
      }
      const fullPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        await collectPaths(fullPath, depth + 1);
      } else if (dirent.isFile()) {
        discoveredFiles.push({ name: dirent.name, fullPath });
      }
    }
  }

  await collectPaths(rootDir, 0);

  const entries = await mapWithConcurrency(discoveredFiles, 12, async (item): Promise<FileEntry | null> => {
    try {
      const stat = await fs.stat(item.fullPath);
      const { mediaType, extension } = classifyFile(item.name, false);
      const meta = await shotDateFor(item.fullPath, stat, readMetadata);

      return {
        name: item.name,
        relativePath: path.relative(rootDir, item.fullPath),
        fullPath: item.fullPath,
        isDirectory: false,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        shotTimeMs: meta.shotTimeMs,
        dateSource: meta.dateSource,
        mediaType,
        extension,
      };
    } catch {
      return null;
    }
  });

  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Quét đúng các file / thư mục được người dùng tích chọn bên trong `rootDir`,
 * KHÔNG quét các thư mục anh em khác (nhanh và tránh quét nhầm show khác).
 */
export async function scanSelectedFiles(
  rootDir: string,
  selectedPaths: string[],
  readMetadata: MetadataMode = true,
  options: ScanOptions = DATA_SCAN_OPTIONS
): Promise<FileEntry[]> {
  const seenInputs = new Set<string>();
  const uniqueInputs: string[] = [];
  for (const raw of selectedPaths) {
    const resolved = path.resolve(raw);
    const key = resolved.toLowerCase();
    if (!seenInputs.has(key)) {
      seenInputs.add(key);
      uniqueInputs.push(resolved);
    }
  }

  const byFullPath = new Map<string, FileEntry>();
  for (const target of uniqueInputs) {
    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const subEntries = await scanFilesRecursive(target, readMetadata, options);
      for (const entry of subEntries) {
        const key = path.resolve(entry.fullPath).toLowerCase();
        if (!byFullPath.has(key)) {
          byFullPath.set(key, {
            ...entry,
            relativePath: path.relative(rootDir, entry.fullPath),
          });
        }
      }
    } else if (stat.isFile()) {
      const name = path.basename(target);
      if (isIgnoredSystemName(name)) continue;
      const key = target.toLowerCase();
      if (byFullPath.has(key)) continue;
      const { mediaType, extension } = classifyFile(name, false);
      const meta = await shotDateFor(target, stat, readMetadata);
      byFullPath.set(key, {
        name,
        relativePath: path.relative(rootDir, target),
        fullPath: target,
        isDirectory: false,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        shotTimeMs: meta.shotTimeMs,
        dateSource: meta.dateSource,
        mediaType,
        extension,
      });
    }
  }

  return Array.from(byFullPath.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
