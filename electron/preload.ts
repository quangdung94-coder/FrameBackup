import { contextBridge, ipcRenderer } from 'electron';
import type { CopyProgressEvent, CopyVerifyRequest, CopyVerifySummary } from './services/copyVerifyService';
import type { DriveInfo, FileEntry } from './services/diskService';
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

  // Phase 2: Copy & Verify (XXHash64)
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
};

contextBridge.exposeInMainWorld('frameBackup', api);
