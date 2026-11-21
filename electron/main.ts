import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { initializeStorage } from '../src/storage/database.js';
import { readBoothSetting, writeBoothSetting } from '../src/storage/settings.js';

const settingKeys = new Set(['selectedCameraId', 'countdownSeconds', 'cameraResolution']);

function validateSettingKey(key: unknown): void {
  if (typeof key !== 'string' || !settingKeys.has(key)) throw new Error('Unsupported setting');
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  initializeStorage(userDataPath);

  ipcMain.handle('settings:get', (_event, key: unknown) => {
    validateSettingKey(key);
    return readBoothSetting(userDataPath, key);
  });
  ipcMain.handle('settings:set', (_event, key: unknown, value: unknown) => {
    validateSettingKey(key);
    writeBoothSetting(userDataPath, key, value);
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
