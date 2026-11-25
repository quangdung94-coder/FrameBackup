import type { BrowserWindow } from 'electron';
import type { IpcEventChannel } from '../shared/ipcChannels';

/** Ngữ cảnh chung cho các module IPC: lấy cửa sổ chính & gửi sự kiện tiến trình an toàn. */
export interface IpcContext {
  getWindow: () => BrowserWindow | null;
  send: (channel: IpcEventChannel, payload: unknown) => void;
}

export function createIpcContext(getWindow: () => BrowserWindow | null): IpcContext {
  return {
    getWindow,
    send(channel, payload) {
      const win = getWindow();
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    },
  };
}
