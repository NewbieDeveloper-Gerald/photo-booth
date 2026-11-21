import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { initializeStorage } from '../src/storage/database.js';
import { readBoothSetting, writeBoothSetting } from '../src/storage/settings.js';
import { isBelowDiskWarningThreshold } from '../src/core/disk-space.js';
import { abandonSession, commitRetake, createSession, discardSession, exportEventFolder, getActiveEvent, getConfiguredStoragePaths, listUnfinishedSessions, loadSession, readOriginalPhoto, revertRetake, saveDownloadCopy, saveOriginalPhoto, saveRetakeOriginalPhoto, saveSessionOutput, setActiveEventRetakeLimit } from '../src/storage/sessions.js';

const settingKeys = new Set(['selectedCameraId', 'countdownSeconds', 'cameraResolution', 'lowDiskWarningGB']);

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
  ipcMain.handle('session:getActiveEvent', () => getActiveEvent(userDataPath));
  ipcMain.handle('session:exportEvent', async (_event, eventId: unknown) => {
    if (typeof eventId !== 'string') throw new Error('Invalid event');
    const selection = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return exportEventFolder(userDataPath, eventId, selection.filePaths[0]);
  });
  ipcMain.handle('session:checkDiskSpace', async (_event, thresholdGB: unknown) => {
    if (typeof thresholdGB !== 'number' || !Number.isFinite(thresholdGB) || thresholdGB < 0 || thresholdGB > 1000) throw new Error('Invalid disk warning threshold');
    const { photosDirectory } = getConfiguredStoragePaths(userDataPath);
    const stats = fs.statfsSync(photosDirectory);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!isBelowDiskWarningThreshold(freeBytes, thresholdGB)) return true;
    const options = {
      type: 'warning' as const, title: 'Low disk space', buttons: ['Continue anyway', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Only ${(freeBytes / 1024 ** 3).toFixed(2)} GB is free on the photo drive.`,
      detail: `The warning threshold is ${thresholdGB} GB. Continue only if you have enough room for this session.`,
    };
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const response = focusedWindow ? await dialog.showMessageBox(focusedWindow, options) : await dialog.showMessageBox(options);
    return response.response === 0;
  });
  ipcMain.handle('session:setRetakeLimit', (_event, limit: unknown) => setActiveEventRetakeLimit(userDataPath, limit));
  ipcMain.handle('session:create', (_event, layoutId: unknown) => createSession(userDataPath, layoutId));
  ipcMain.handle('session:listUnfinished', () => listUnfinishedSessions(userDataPath));
  ipcMain.handle('session:load', (_event, sessionId: unknown) => loadSession(userDataPath, sessionId));
  ipcMain.handle('session:saveOriginal', (_event, sessionId: unknown, slotNumber: unknown, bytes: unknown, width: unknown, height: unknown) =>
    saveOriginalPhoto(userDataPath, sessionId, slotNumber, bytes, width, height));
  ipcMain.handle('session:saveRetakeOriginal', (_event, sessionId: unknown, slotNumber: unknown, bytes: unknown, width: unknown, height: unknown) =>
    saveRetakeOriginalPhoto(userDataPath, sessionId, slotNumber, bytes, width, height));
  ipcMain.handle('session:saveDownload', (_event, photoId: unknown, bytes: unknown) => saveDownloadCopy(userDataPath, photoId, bytes));
  ipcMain.handle('session:commitRetake', (_event, sessionId: unknown, slotNumber: unknown, photoId: unknown) => commitRetake(userDataPath, sessionId, slotNumber, photoId));
  ipcMain.handle('session:revertRetake', (_event, sessionId: unknown, slotNumber: unknown) => revertRetake(userDataPath, sessionId, slotNumber));
  ipcMain.handle('session:readOriginal', (_event, photoId: unknown) => readOriginalPhoto(userDataPath, photoId));
  ipcMain.handle('session:saveOutput', (_event, sessionId: unknown, bytes: unknown, width: unknown, height: unknown) =>
    saveSessionOutput(userDataPath, sessionId, bytes, width, height));
  ipcMain.handle('session:abandon', (_event, sessionId: unknown) => abandonSession(userDataPath, sessionId));
  ipcMain.handle('session:discard', (_event, sessionId: unknown) => discardSession(userDataPath, sessionId));

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
