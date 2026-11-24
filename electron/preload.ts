import { contextBridge, ipcRenderer } from 'electron';
import type { DriveInfo, FileEntry } from './services/diskService';

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
  pickDirectory: (title?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory', title),
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke('system:openExternal', url),
};

contextBridge.exposeInMainWorld('frameBackup', api);
