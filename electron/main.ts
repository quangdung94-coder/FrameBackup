import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { createIpcContext, registerIpcHandlers, shutdownBackgroundJobs } from './ipc';
import { initGoogleDriveStorage } from './services/googleDriveService';
import { flushShotDateCache, initShotDateCache } from './services/shotDateCache';
import { stopDriveWatcher } from './services/driveWatcher';
import { initVerifyLedger } from './services/verifyLedger';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const iconPath = path.join(__dirname, '../build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#121215',
    icon: iconPath,
    title: 'FrameBackup — 4-Column Video & Photo Backup',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Chuột phải vào ô nhập chữ (link Drive, tên Show, đường dẫn...): Cắt / Sao chép / Dán / Chọn hết
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    const f = params.editFlags;
    Menu.buildFromTemplate([
      { label: 'Undo', role: 'undo', enabled: f.canUndo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: f.canCut },
      { label: 'Copy', role: 'copy', enabled: f.canCopy },
      { label: 'Paste', role: 'paste', enabled: f.canPaste },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll', enabled: f.canSelectAll },
    ]).popup({ window: mainWindow ?? undefined });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  // Another instance of FrameBackup is already running — quit immediately to avoid black screen / cache lock
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    initVerifyLedger(app.getPath('userData'));
    initShotDateCache(app.getPath('userData'));
    initGoogleDriveStorage(app.getPath('userData'), [
      process.resourcesPath, // bản đã đóng gói: resources/google-oauth-client.json
      path.join(app.getAppPath(), 'build'), // npm run dev: build/google-oauth-client.json
    ]);
    registerIpcHandlers(createIpcContext(() => mainWindow));
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });
}

app.on('window-all-closed', async () => {
  stopDriveWatcher();
  flushShotDateCache();
  await shutdownBackgroundJobs();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
