import { app, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import { listDirectoryEntries, listSystemDrives, scanFilesRecursive, VIEW_SCAN_OPTIONS } from '../services/diskService';
import { deletePartFiles } from '../services/copyVerifyService';
import { safeEjectDrive } from '../services/ejectService';
import { startDriveWatcher } from '../services/driveWatcher';
import { getMediaThumbnail, initMediaInfo, probeMediaInfo } from '../services/mediaInfoService';
import { cancelShotDates, createFolder, getPathProperties, readShotDates, renamePath } from '../services/fileOpsService';
import { IPC, IPC_EVENTS } from '../shared/ipcChannels';
import type { MediaThumbRequest, ShotDateRequestItem, SpecialFolder } from '../shared/types';
import type { IpcContext } from './context';

export function registerDiskIpc(ctx: IpcContext) {
  ipcMain.handle(IPC.disk.listDrives, async () => listSystemDrives());
  // v1.4 kiểu xem: thông tin clip, hình thu nhỏ, dải hình tua nhanh
  initMediaInfo(app.getPath('userData'));
  ipcMain.handle(IPC.mediaView.probe, async (_e, paths: string[]) => probeMediaInfo(Array.isArray(paths) ? paths.map(String) : []));
  ipcMain.handle(IPC.mediaView.thumbnail, async (_e, req: MediaThumbRequest) => getMediaThumbnail({ path: String(req?.path ?? '') }));
  // Cắm / rút thẻ, ổ cứng => báo giao diện danh sách ổ mới
  startDriveWatcher((drives) => ctx.send(IPC_EVENTS.drivesChanged, drives));
  ipcMain.handle(IPC.disk.listDirectory, async (_event, dirPath: string) => listDirectoryEntries(dirPath, true));
  ipcMain.handle(IPC.disk.scanRecursive, async (_event, dirPath: string) => scanFilesRecursive(dirPath, true, VIEW_SCAN_OPTIONS));
  // Quét nhanh (hiện danh sách ngay), ngày chụp đọc ngầm sau
  ipcMain.handle(IPC.disk.scanRecursiveQuick, async (_event, dirPath: string) => scanFilesRecursive(dirPath, 'cached', VIEW_SCAN_OPTIONS));
  ipcMain.handle(IPC.disk.readShotDates, async (_event, key: string, items: ShotDateRequestItem[]) => {
    if (typeof key !== 'string' || !Array.isArray(items)) return;
    await readShotDates(key, items, (ev) => ctx.send(IPC_EVENTS.shotDates, ev));
  });
  ipcMain.handle(IPC.disk.cancelShotDates, (_event, key: string) => cancelShotDates(String(key)));
  ipcMain.handle(IPC.disk.createFolder, async (_event, parentDir: string, name: string) => createFolder(parentDir, name));
  ipcMain.handle(IPC.disk.rename, async (_event, fullPath: string, name: string) => renamePath(fullPath, name));
  ipcMain.handle(IPC.disk.properties, async (_event, fullPath: string) => getPathProperties(fullPath));
  ipcMain.handle(IPC.disk.specialFolders, async (): Promise<SpecialFolder[]> => {
    const list: Array<[SpecialFolder['id'], string, Parameters<typeof app.getPath>[0]]> = [
      ['desktop', 'Desktop', 'desktop'],
      ['documents', 'Tài liệu', 'documents'],
      ['downloads', 'Tải về', 'downloads'],
      ['pictures', 'Ảnh', 'pictures'],
      ['videos', 'Video', 'videos'],
    ];
    const out: SpecialFolder[] = [];
    for (const [id, label, key] of list) {
      try {
        out.push({ id, label, path: app.getPath(key) });
      } catch {
        // thư mục không có trên máy này
      }
    }
    return out;
  });
  ipcMain.handle(IPC.disk.ensureDir, async (_event, dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
  });
  ipcMain.handle(IPC.disk.deletePartFiles, async (_event, paths: string[]) =>
    deletePartFiles(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [])
  );
  ipcMain.handle(IPC.disk.safeEject, async (_event, mountPath: string) => safeEjectDrive(mountPath));
}
