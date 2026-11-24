import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readMediaShotDate, type DateSource } from './metadataService';

const execFileAsync = promisify(execFile);

export interface DriveInfo {
  id: string;
  label: string;
  mountPath: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
  isRemovable: boolean;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  fullPath: string;
  isDirectory: boolean;
  sizeBytes: number;
  mtimeMs: number;
  shotTimeMs: number;
  dateSource: DateSource;
  mediaType: 'video' | 'photo' | 'raw' | 'folder' | 'other';
  extension: string;
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mxf', '.mkv', '.avi', '.mts', '.m2ts', '.braw', '.r3d']);
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp', '.tif', '.tiff']);
const RAW_EXTS = new Set(['.arw', '.cr2', '.cr3', '.nef', '.raf', '.dng', '.orf', '.rw2', '.pef']);

export function isIgnoredSystemName(name: string): boolean {
  return (
    name.startsWith('._') ||
    name.endsWith('.fbpart') ||
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
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psScript], {
      windowsHide: true,
    });
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

export async function listDirectoryEntries(dirPath: string, readMetadata = true): Promise<FileEntry[]> {
  if (!dirPath) return [];
  try {
    const dirents = (await fs.readdir(dirPath, { withFileTypes: true })).filter((d) => !isIgnoredSystemName(d.name));

    const entries = await mapWithConcurrency(dirents, 12, async (dirent): Promise<FileEntry | null> => {
      const fullPath = path.join(dirPath, dirent.name);
      try {
        const stat = await fs.stat(fullPath);
        const isDir = stat.isDirectory();
        const { mediaType, extension } = classifyFile(dirent.name, isDir);
        const meta =
          !isDir && readMetadata
            ? await readMediaShotDate(fullPath, stat.mtimeMs)
            : { shotTimeMs: stat.mtimeMs, dateSource: 'mtime' as DateSource };

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

export async function scanFilesRecursive(rootDir: string, readMetadata = true, maxDepth = 10): Promise<FileEntry[]> {
  const discoveredFiles: Array<{ name: string; fullPath: string }> = [];

  async function collectPaths(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    let dirents;
    try {
      dirents = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (isIgnoredSystemName(dirent.name)) continue;
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
      const meta = readMetadata
        ? await readMediaShotDate(item.fullPath, stat.mtimeMs)
        : { shotTimeMs: stat.mtimeMs, dateSource: 'mtime' as DateSource };

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
