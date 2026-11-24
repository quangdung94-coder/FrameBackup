import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { listDirectoryEntries, listSystemDrives } from './services/diskService';

let mainWindow: BrowserWindow | null = null;
let powerSaveId: number | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#121215',
    title: 'FrameBackup — 4-Column Video & Photo Backup',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('system:getInfo', () => ({
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    preventSleepActive: powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId),
  }));

  ipcMain.handle('system:setPreventSleep', (_event, enabled: boolean) => {
    if (enabled) {
      if (powerSaveId === null || !powerSaveBlocker.isStarted(powerSaveId)) {
        powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
      }
      return true;
    }
    if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
    }
    powerSaveId = null;
    return false;
  });

  ipcMain.handle('disk:listDrives', async () => listSystemDrives());

  ipcMain.handle('disk:listDirectory', async (_event, dirPath: string) => listDirectoryEntries(dirPath));

  ipcMain.handle('dialog:pickDirectory', async (_event, title?: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Chọn thư mục',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('system:openExternal', async (_event, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      await shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
