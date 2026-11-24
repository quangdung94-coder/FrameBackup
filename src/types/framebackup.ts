export type DateSource = 'exif' | 'video-atom' | 'mtime';
export type DateFilterMode = 'all' | 'target-only' | 'split';
export type CopyEngineId = 'builtin' | 'teracopy' | 'robocopy' | 'fastcopy' | 'rsync' | 'ditto';

export interface CopyEngineOption {
  id: CopyEngineId;
  name: string;
  description: string;
  available: boolean;
  executablePath?: string;
  platform: 'all' | 'win32' | 'darwin';
}

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

export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  preventSleepActive: boolean;
}

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

export interface WatchStatusEvent {
  state: 'idle' | 'watching' | 'receiving' | 'stabilizing' | 'ready' | 'error';
  watchDir: string;
  fileCount: number;
  countdownSec: number;
  lockedFiles: number;
  message: string;
}

export type PackMode = 'video-raw-smart' | 'none' | 'zip-store' | '7z';

export interface ShotInfo {
  name: string;
  relativePath: string;
  shotTimeMs: number;
  mediaType: FileEntry['mediaType'];
  thumbnailPath?: string;
  thumbnailFileName?: string;
  thumbnailDataUrl?: string;
}

export interface MediaReportResult {
  projectName: string;
  stagingDir: string;
  reportFilePath: string;
  reportFileName: string;
  reportText: string;
  totalFiles: number;
  videoCount: number;
  photoCount: number;
  rawCount: number;
  totalBytes: number;
  firstShot: ShotInfo | null;
  lastShot: ShotInfo | null;
}

export interface InspectReportRequest {
  projectName: string;
  sourceDir: string;
  verifyStatusText?: string;
  skippedOldFiles?: number;
  keptMismatchFiles?: number;
}

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

export interface DriveAuthStatus {
  hasCredentials: boolean;
  signedIn: boolean;
  email?: string;
  displayName?: string;
  quotaLimitBytes?: number;
  quotaUsageBytes?: number;
  error?: string;
}

export interface DriveRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  isFolder: boolean;
}

export interface DriveFolderCheckResult {
  ok: boolean;
  folderId?: string;
  folderName?: string;
  canEdit: boolean;
  webViewLink?: string;
  files: DriveRemoteFile[];
  error?: string;
}

export interface DriveUploadItem {
  localPath: string;
  remoteName: string;
  relativeSubdir?: string;
}

export interface DriveUploadRequest {
  parentFolderId: string;
  createProjectSubfolder?: string;
  items: DriveUploadItem[];
  cleanupArchivePaths?: string[];
}

export interface DriveUploadProgressEvent {
  status: 'preparing' | 'uploading' | 'completed' | 'cancelled' | 'error';
  currentFile: string;
  filesUploaded: number;
  totalFiles: number;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
  speedMBs: number;
  error?: string;
}

export interface DriveUploadSummary {
  success: boolean;
  targetFolderId: string;
  webViewLink?: string;
  filesUploaded: number;
  totalFiles: number;
  totalBytes: number;
  error?: string;
}

export type PowerActionType = 'sleep' | 'shutdown';

export interface BackupHistoryItem {
  id: string;
  completedAt: number;
  projectName: string;
  totalFiles: number;
  totalBytes: number;
  drive1Path: string;
  drive2BackedUp: boolean;
  driveUploaded: boolean;
  driveWebLink?: string;
}

export interface FrameBackupBridge {
  getSystemInfo: () => Promise<SystemInfo>;
  setPreventSleep: (enabled: boolean) => Promise<boolean>;
  listDrives: () => Promise<DriveInfo[]>;
  listDirectory: (dirPath: string) => Promise<FileEntry[]>;
  scanRecursive: (dirPath: string) => Promise<FileEntry[]>;
  ensureDirectory: (dirPath: string) => Promise<string>;
  pickDirectory: (title?: string) => Promise<string | null>;
  openExternalUrl: (url: string) => Promise<void>;
  listCopyEngines: () => Promise<CopyEngineOption[]>;
  startCopyVerify: (req: CopyVerifyRequest) => Promise<CopyVerifySummary>;
  cancelCopy: () => Promise<boolean>;
  onCopyProgress: (cb: (ev: CopyProgressEvent) => void) => () => void;
  startWatch: (dirPath: string, debounceSec: number) => Promise<void>;
  stopWatch: () => Promise<void>;
  triggerWatchNow: () => Promise<void>;
  onWatchStatus: (cb: (ev: WatchStatusEvent) => void) => () => void;
  safeEject: (mountPath: string) => Promise<{ ok: boolean; message: string }>;
  inspectAndBuildReport: (req: InspectReportRequest) => Promise<MediaReportResult>;
  packageForDrive: (req: PackageRequest) => Promise<PackageResult>;
  cancelPackaging: () => Promise<boolean>;
  onPackageProgress: (cb: (ev: PackageProgressEvent) => void) => () => void;
  getDriveAuthStatus: () => Promise<DriveAuthStatus>;
  importDriveCredentials: () => Promise<{ ok: boolean; message: string }>;
  signInGoogleDrive: () => Promise<DriveAuthStatus>;
  signOutGoogleDrive: () => Promise<DriveAuthStatus>;
  checkDriveFolder: (urlOrId: string) => Promise<DriveFolderCheckResult>;
  uploadToGoogleDrive: (req: DriveUploadRequest) => Promise<DriveUploadSummary>;
  cancelDriveUpload: () => Promise<boolean>;
  onDriveUploadProgress: (cb: (ev: DriveUploadProgressEvent) => void) => () => void;
  executePowerAction: (action: PowerActionType) => Promise<{ ok: boolean; message: string }>;
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

export function isTimestampMatchingTargetDate(
  shotTimeMs: number,
  targetDateStr: string,
  overnightMode: boolean
): boolean {
  if (!targetDateStr) return true;
  const fileKey = formatDateKey(shotTimeMs);
  if (fileKey === targetDateStr) return true;

  if (overnightMode) {
    const fileDate = new Date(shotTimeMs);
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

/** Removes characters illegal in Windows/macOS folder names. */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
}

export function getParentDirectory(dirPath: string): string | null {
  if (!dirPath) return null;
  const isWin = dirPath.includes('\\') || /^[A-Za-z]:/.test(dirPath);
  const sep = isWin ? '\\' : '/';
  const cleaned = dirPath.replace(/[\\/]+$/, '');
  if (!cleaned || (isWin && /^[A-Za-z]:$/.test(cleaned))) return null;
  const idx = Math.max(cleaned.lastIndexOf('\\'), cleaned.lastIndexOf('/'));
  if (idx < 0) return null;
  const parent = cleaned.slice(0, idx);
  if (isWin && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent || sep;
}
