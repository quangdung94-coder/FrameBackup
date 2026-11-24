import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

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
  fullPath: string;
  isDirectory: boolean;
  sizeBytes: number;
  mtimeMs: number;
  mediaType: 'video' | 'photo' | 'raw' | 'folder' | 'other';
  extension: string;
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mxf', '.mkv', '.avi', '.mts', '.m2ts', '.braw', '.r3d']);
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp', '.tif', '.tiff']);
const RAW_EXTS = new Set(['.arw', '.cr2', '.cr3', '.nef', '.raf', '.dng', '.orf', '.rw2', '.pef']);

function classifyFile(fileName: string, isDirectory: boolean): { mediaType: FileEntry['mediaType']; extension: string } {
  if (isDirectory) return { mediaType: 'folder', extension: '' };
  const ext = path.extname(fileName).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return { mediaType: 'video', extension: ext };
  if (RAW_EXTS.has(ext)) return { mediaType: 'raw', extension: ext };
  if (PHOTO_EXTS.has(ext)) return { mediaType: 'photo', extension: ext };
  return { mediaType: 'other', extension: ext };
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

export async function listDirectoryEntries(dirPath: string): Promise<FileEntry[]> {
  if (!dirPath) return [];
  try {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    const entries: FileEntry[] = [];

    for (const dirent of dirents) {
      // Skip OS metadata/hidden junk
      if (
        dirent.name.startsWith('._') ||
        dirent.name === '.DS_Store' ||
        dirent.name === 'Thumbs.db' ||
        dirent.name === '$RECYCLE.BIN' ||
        dirent.name === 'System Volume Information'
      ) {
        continue;
      }
      const fullPath = path.join(dirPath, dirent.name);
      try {
        const stat = await fs.stat(fullPath);
        const isDir = stat.isDirectory();
        const { mediaType, extension } = classifyFile(dirent.name, isDir);
        entries.push({
          name: dirent.name,
          fullPath,
          isDirectory: isDir,
          sizeBytes: isDir ? 0 : stat.size,
          mtimeMs: stat.mtimeMs,
          mediaType,
          extension,
        });
      } catch {
        // Ignore unreadable system entries
      }
    }

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    console.error(`[diskService] Failed to read directory "${dirPath}":`, err);
    return [];
  }
}
