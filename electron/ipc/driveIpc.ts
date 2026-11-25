import { dialog, ipcMain, shell } from 'electron';
import {
  cancelDriveUpload,
  cancelGoogleSignIn,
  checkDriveFolderAccess,
  getDriveAuthStatus,
  importOAuthCredentials,
  removeCustomClient,
  signInGoogleDrive,
  signOutGoogleDrive,
  uploadProjectToDrive,
} from '../services/googleDriveService';
import { detectBrowsers, openUrlInBrowser } from '../services/browserService';
import { IPC, IPC_EVENTS } from '../shared/ipcChannels';
import type { DriveUploadRequest } from '../shared/types';
import type { IpcContext } from './context';

/** Phase 4: Google Drive OAuth, Folder Check & Resumable Upload. */
export function registerDriveIpc(ctx: IpcContext) {
  ipcMain.handle(IPC.drive.getAuthStatus, async () => getDriveAuthStatus());

  ipcMain.handle(IPC.drive.importCredentials, async () => {
    const win = ctx.getWindow();
    if (!win) return { ok: false, message: 'Cửa sổ chính chưa sẵn sàng.' };
    const picked = await dialog.showOpenDialog(win, {
      title: 'Chọn file Google OAuth credentials.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, message: 'Đã hủy chọn file.' };
    }
    return importOAuthCredentials(picked.filePaths[0]);
  });

  ipcMain.handle(IPC.drive.signIn, async (_event, browserId?: string) =>
    signInGoogleDrive((url) =>
      openUrlInBrowser(url, typeof browserId === 'string' ? browserId : undefined, (u) => shell.openExternal(u))
    )
  );
  ipcMain.handle(IPC.drive.cancelSignIn, () => cancelGoogleSignIn());
  ipcMain.handle(IPC.drive.listBrowsers, () => detectBrowsers());
  ipcMain.handle(IPC.drive.useBuiltInClient, async () => {
    await removeCustomClient();
    return getDriveAuthStatus();
  });
  ipcMain.handle(IPC.drive.signOut, async () => signOutGoogleDrive());
  ipcMain.handle(IPC.drive.checkFolder, async (_event, urlOrId: string) => checkDriveFolderAccess(urlOrId));
  ipcMain.handle(IPC.drive.upload, async (_event, req: DriveUploadRequest) =>
    uploadProjectToDrive(req, (progress) => ctx.send(IPC_EVENTS.driveUploadProgress, { ...progress, jobId: req.jobId }))
  );
  ipcMain.handle(IPC.drive.cancelUpload, (_event, jobId?: string) =>
    cancelDriveUpload(typeof jobId === 'string' && jobId ? jobId : undefined)
  );
}

export function stopDriveJobs() {
  cancelDriveUpload();
  cancelGoogleSignIn();
}
