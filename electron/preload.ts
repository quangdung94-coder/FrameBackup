import { contextBridge, ipcRenderer } from 'electron';
import type { CopyEngineOption } from './services/copyEngineService';
import type { CopyProgressEvent, CopyVerifyRequest, CopyVerifySummary } from './services/copyVerifyService';
import type { DriveInfo, FileEntry } from './services/diskService';
import type {
  DriveAuthStatus,
  DriveFolderCheckResult,
  DriveUploadProgressEvent,
  DriveUploadRequest,
  DriveUploadSummary,
} from './services/googleDriveService';
import type { InspectReportRequest, MediaReportResult } from './services/mediaInspectorService';
import type { PackageProgressEvent, PackageRequest, PackageResult } from './services/packagingService';
import type { WatchStatusEvent } from './services/watchService';

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  hostname: string;
  preventSleepActive: boolean;
}

const api = {
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('system:getInfo'),
  setPreventSleep: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('system:setPreventSleep', enabled),
  listDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke('disk:listDrives'),
  listDirectory: (dirPath: string): Promise<FileEntry[]> => ipcRenderer.invoke('disk:listDirectory', dirPath),
  scanRecursive: (dirPath: string): Promise<FileEntry[]> => ipcRenderer.invoke('disk:scanRecursive', dirPath),
  pickDirectory: (title?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory', title),
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke('system:openExternal', url),

  // Phase 2: Copy & Verify (XXHash64 + External Engines)
  listCopyEngines: (): Promise<CopyEngineOption[]> => ipcRenderer.invoke('copy:listEngines'),
  startCopyVerify: (req: CopyVerifyRequest): Promise<CopyVerifySummary> => ipcRenderer.invoke('copy:start', req),
  cancelCopy: (): Promise<boolean> => ipcRenderer.invoke('copy:cancel'),
  onCopyProgress: (callback: (ev: CopyProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CopyProgressEvent) => callback(data);
    ipcRenderer.on('copy:progress', handler);
    return () => ipcRenderer.removeListener('copy:progress', handler);
  },

  // Phase 2: Watch Mode (Explorer / TeraCopy / Finder)
  startWatch: (dirPath: string, debounceSec: number): Promise<void> =>
    ipcRenderer.invoke('watch:start', dirPath, debounceSec),
  stopWatch: (): Promise<void> => ipcRenderer.invoke('watch:stop'),
  triggerWatchNow: (): Promise<void> => ipcRenderer.invoke('watch:triggerNow'),
  onWatchStatus: (callback: (ev: WatchStatusEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: WatchStatusEvent) => callback(data);
    ipcRenderer.on('watch:status', handler);
    return () => ipcRenderer.removeListener('watch:status', handler);
  },

  // Phase 2: Safe Eject
  safeEject: (mountPath: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('disk:safeEject', mountPath),

  // Phase 3: Media Inspector, Thumbnails & Packaging
  inspectAndBuildReport: (req: InspectReportRequest): Promise<MediaReportResult> =>
    ipcRenderer.invoke('media:inspectAndReport', req),
  packageForDrive: (req: PackageRequest): Promise<PackageResult> =>
    ipcRenderer.invoke('package:start', req),
  cancelPackaging: (): Promise<boolean> => ipcRenderer.invoke('package:cancel'),
  onPackageProgress: (callback: (ev: PackageProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PackageProgressEvent) => callback(data);
    ipcRenderer.on('package:progress', handler);
    return () => ipcRenderer.removeListener('package:progress', handler);
  },

  // Phase 4: Google Drive API v3
  getDriveAuthStatus: (): Promise<DriveAuthStatus> => ipcRenderer.invoke('drive:getAuthStatus'),
  importDriveCredentials: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('drive:importCredentials'),
  signInGoogleDrive: (): Promise<DriveAuthStatus> => ipcRenderer.invoke('drive:signIn'),
  signOutGoogleDrive: (): Promise<DriveAuthStatus> => ipcRenderer.invoke('drive:signOut'),
  checkDriveFolder: (urlOrId: string): Promise<DriveFolderCheckResult> =>
    ipcRenderer.invoke('drive:checkFolder', urlOrId),
  uploadToGoogleDrive: (req: DriveUploadRequest): Promise<DriveUploadSummary> =>
    ipcRenderer.invoke('drive:upload', req),
  cancelDriveUpload: (): Promise<boolean> => ipcRenderer.invoke('drive:cancelUpload'),
  onDriveUploadProgress: (callback: (ev: DriveUploadProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DriveUploadProgressEvent) => callback(data);
    ipcRenderer.on('drive:uploadProgress', handler);
    return () => ipcRenderer.removeListener('drive:uploadProgress', handler);
  },
};

contextBridge.exposeInMainWorld('frameBackup', api);
