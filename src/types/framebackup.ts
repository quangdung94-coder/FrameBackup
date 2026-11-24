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

export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  preventSleepActive: boolean;
}

export interface FrameBackupBridge {
  getSystemInfo: () => Promise<SystemInfo>;
  setPreventSleep: (enabled: boolean) => Promise<boolean>;
  listDrives: () => Promise<DriveInfo[]>;
  listDirectory: (dirPath: string) => Promise<FileEntry[]>;
  pickDirectory: (title?: string) => Promise<string | null>;
  openExternalUrl: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    frameBackup?: FrameBackupBridge;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[i]}`;
}

export function formatShortDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDisplayDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-');
  if (!y || !m || !d) return yyyyMmDd;
  return `${d}/${m}/${y}`;
}

/**
 * Checks whether a file timestamp matches the target shoot date.
 * If overnightMode is enabled, files created between 00:00 and 04:00 of the next day
 * are also considered part of the target shoot date.
 */
export function isTimestampMatchingTargetDate(
  mtimeMs: number,
  targetDateStr: string,
  overnightMode: boolean
): boolean {
  if (!targetDateStr) return true;
  const fileKey = formatDateKey(mtimeMs);
  if (fileKey === targetDateStr) return true;

  if (overnightMode) {
    const fileDate = new Date(mtimeMs);
    const targetStart = new Date(`${targetDateStr}T00:00:00`);
    const nextDay = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);
    const nextDayKey = formatDateKey(nextDay.getTime());
    if (fileKey === nextDayKey && fileDate.getHours() < 4) {
      return true;
    }
  }
  return false;
}

export function parseGoogleDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParamMatch) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed;
  return null;
}
