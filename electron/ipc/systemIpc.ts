import { dialog, ipcMain, shell } from 'electron';
import os from 'node:os';
import { executePowerAction } from '../services/powerService';
import { IPC } from '../shared/ipcChannels';
import type { PowerActionType, SystemInfo } from '../shared/types';
import type { IpcContext } from './context';
import { isPreventSleepActive, releasePreventSleep, setPreventSleep } from './powerSave';

export function registerSystemIpc(ctx: IpcContext) {
  ipcMain.handle(IPC.system.getInfo, (): SystemInfo => ({
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    preventSleepActive: isPreventSleepActive(),
  }));

  ipcMain.handle(IPC.system.setPreventSleep, (_event, enabled: boolean) => setPreventSleep(enabled));

  ipcMain.handle(IPC.dialog.pickDirectory, async (_event, title?: string) => {
    const win = ctx.getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: title || 'Chọn thư mục',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.system.openExternal, async (_event, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      await shell.openExternal(url);
    }
  });

  // Mở file / thư mục bằng app mặc định của hệ điều hành (chuột phải > Mở)
  ipcMain.handle(IPC.system.openPath, async (_event, fullPath: string) => {
    if (typeof fullPath !== 'string' || !fullPath) return { ok: false, message: 'Đường dẫn trống' };
    const err = await shell.openPath(fullPath);
    return err ? { ok: false, message: err } : { ok: true, message: 'Đã mở' };
  });
  ipcMain.handle(IPC.system.showInFolder, (_event, fullPath: string) => {
    if (typeof fullPath === 'string' && fullPath) shell.showItemInFolder(fullPath);
  });

  // Phase 5: Power Management (Sleep / Shutdown)
  ipcMain.handle(IPC.system.powerAction, async (_event, action: PowerActionType) => {
    releasePreventSleep();
    return executePowerAction(action);
  });
}
