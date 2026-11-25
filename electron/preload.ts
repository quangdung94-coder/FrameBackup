import { contextBridge, ipcRenderer } from 'electron';
import { IPC, IPC_EVENTS, type IpcEventChannel } from './shared/ipcChannels';
import type { FrameBackupBridge } from './shared/types';

// Lưu ý: preload `require` được ./shared/ipcChannels vì BrowserWindow đang chạy với sandbox: false.

export type { SystemInfo } from './shared/types';

/** Gọi 1 handler ipcMain.handle. */
const invoke =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args);

/** Đăng ký nghe 1 kênh tiến trình, trả về hàm hủy đăng ký. */
const subscribe =
  <T>(channel: IpcEventChannel) =>
  (callback: (ev: T) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };

const api: FrameBackupBridge = {
  getSystemInfo: invoke(IPC.system.getInfo),
  setPreventSleep: invoke(IPC.system.setPreventSleep),
  listDrives: invoke(IPC.disk.listDrives),
  listDirectory: invoke(IPC.disk.listDirectory),
  scanRecursive: invoke(IPC.disk.scanRecursive),
  scanRecursiveQuick: invoke(IPC.disk.scanRecursiveQuick),
  readShotDates: invoke(IPC.disk.readShotDates),
  cancelShotDates: invoke(IPC.disk.cancelShotDates),
  onShotDates: subscribe(IPC_EVENTS.shotDates),
  onDrivesChanged: subscribe(IPC_EVENTS.drivesChanged),
  createFolder: invoke(IPC.disk.createFolder),
  renamePath: invoke(IPC.disk.rename),
  getPathProperties: invoke(IPC.disk.properties),
  getSpecialFolders: invoke(IPC.disk.specialFolders),
  ensureDirectory: invoke(IPC.disk.ensureDir),
  pickDirectory: invoke(IPC.dialog.pickDirectory),
  openExternalUrl: invoke(IPC.system.openExternal),
  openPath: invoke(IPC.system.openPath),
  showInFolder: invoke(IPC.system.showInFolder),

  // Phase 2: Copy & Verify (XXHash64 + External Engines)
  listCopyEngines: invoke(IPC.copy.listEngines),
  startCopyVerify: invoke(IPC.copy.start),
  cancelCopy: invoke(IPC.copy.cancel),
  preflightCopy: invoke(IPC.copy.preflight),
  deletePartFiles: invoke(IPC.disk.deletePartFiles),
  onCopyProgress: subscribe(IPC_EVENTS.copyProgress),

  // Phase 2: Watch Mode (Explorer / TeraCopy / Finder)
  startWatch: invoke(IPC.watch.start),
  stopWatch: invoke(IPC.watch.stop),
  triggerWatchNow: invoke(IPC.watch.triggerNow),
  onWatchStatus: subscribe(IPC_EVENTS.watchStatus),

  // Phase 2: Safe Eject
  safeEject: invoke(IPC.disk.safeEject),

  // Phase 3: Media Inspector, Thumbnails & Packaging
  inspectAndBuildReport: invoke(IPC.media.inspectAndReport),
  packageForDrive: invoke(IPC.pack.start),
  cancelPackaging: invoke(IPC.pack.cancel),
  buildBackupReport: invoke(IPC.media.buildReport),
  getShowLedger: invoke(IPC.media.showLedger),
  onPackageProgress: subscribe(IPC_EVENTS.packageProgress),

  // Phase 4: Google Drive API v3
  getDriveAuthStatus: invoke(IPC.drive.getAuthStatus),
  importDriveCredentials: invoke(IPC.drive.importCredentials),
  signInGoogleDrive: invoke(IPC.drive.signIn),
  signOutGoogleDrive: invoke(IPC.drive.signOut),
  cancelGoogleSignIn: invoke(IPC.drive.cancelSignIn),
  listBrowsers: invoke(IPC.drive.listBrowsers),
  useBuiltInGoogleClient: invoke(IPC.drive.useBuiltInClient),
  checkDriveFolder: invoke(IPC.drive.checkFolder),
  pickDriveFolder: invoke(IPC.drive.pickFolder),
  probeMediaInfo: invoke(IPC.mediaView.probe),
  getMediaThumbnail: invoke(IPC.mediaView.thumbnail),
  cancelDrivePick: invoke(IPC.drive.cancelPick),
  uploadToGoogleDrive: invoke(IPC.drive.upload),
  cancelDriveUpload: invoke(IPC.drive.cancelUpload),
  onDriveUploadProgress: subscribe(IPC_EVENTS.driveUploadProgress),

  // Phase 5: Power Management
  executePowerAction: invoke(IPC.system.powerAction),
};

contextBridge.exposeInMainWorld('frameBackup', api);
