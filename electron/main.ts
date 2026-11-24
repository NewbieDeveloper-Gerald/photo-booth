import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getConfiguredStoragePaths, initializeStorage, isBelowDiskWarningThreshold, readBoothSetting, writeBoothSetting } from '../src/features/storage/index.js';
import { hasAdminPin, setAdminPin, verifyAdminPin } from '../src/features/security/index.js';
import { ElectronSystemPrinter } from './devices/system-printer.js';
import { pageSizeMicrons } from '../src/features/printing/devices/printer.js';
import { createDownloadServer } from '../src/features/sharing/download-server.js';
import { isBoothSettingKey } from '../src/shared/constants/settings-keys.js';
import { BYTES_PER_GIGABYTE, MAX_DISK_WARNING_GB } from '../src/shared/constants/limits.js';
import { enqueueSessionFiles, listUploadQueue, recoverInterruptedUploads } from '../src/features/sharing/upload-queue/repository.js';
import type { Server } from 'node:http';
import { abandonSession, commitRetake, createSession, discardSession, listUnfinishedSessions, loadSession, readOriginalPhoto, revertRetake, saveDownloadCopy, saveOriginalPhoto, saveRetakeOriginalPhoto, saveSessionOutput } from '../src/features/capture/index.js';
import { duplicateEvent, exportEventFolder, getActiveEvent, getEventLogoDataUrl, listEvents, saveEventSettings, selectActiveEvent, setActiveEventRetakeLimit, setEventLogo } from '../src/features/events/index.js';
import { getLatestSessionPrintInfo } from '../src/features/printing/index.js';
import { createSessionShareLink } from '../src/features/sharing/index.js';

function validateSettingKey(key: unknown): void {
  if (!isBoothSettingKey(key)) throw new Error('Unsupported setting');
}

let mainWindow: BrowserWindow | null = null;
let downloadServer: Server | null = null;
let permitWindowClose = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111827',
    kiosk: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  window.on('close', (event) => {
    if (!permitWindowClose) {
      event.preventDefault();
      window.webContents.send('kiosk:exitRequested');
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }
  return window;
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  initializeStorage(userDataPath);
  recoverInterruptedUploads(userDataPath);
  try {
    const { photosDirectory } = getConfiguredStoragePaths(userDataPath);
    downloadServer = await createDownloadServer(userDataPath, photosDirectory);
  } catch {
    console.warn('Private download service could not start; QR downloads are unavailable until the app is restarted.');
  }

  ipcMain.handle('settings:get', (_event, key: unknown) => {
    validateSettingKey(key);
    return readBoothSetting(userDataPath, key);
  });
  ipcMain.handle('settings:set', (_event, key: unknown, value: unknown) => {
    validateSettingKey(key);
    writeBoothSetting(userDataPath, key, value);
  });
  ipcMain.handle('admin:hasPin', () => hasAdminPin(userDataPath));
  ipcMain.handle('admin:verifyPin', (_event, pin: unknown) => verifyAdminPin(userDataPath, pin));
  ipcMain.handle('admin:setPin', (_event, pin: unknown, currentPin: unknown) => {
    if (hasAdminPin(userDataPath) && !verifyAdminPin(userDataPath, currentPin)) throw new Error('Current admin PIN is incorrect');
    setAdminPin(userDataPath, pin);
  });
  ipcMain.handle('kiosk:exitWithPin', (_event, pin: unknown) => {
    if (!verifyAdminPin(userDataPath, pin)) return false;
    permitWindowClose = true;
    app.quit();
    return true;
  });
  ipcMain.handle('session:getActiveEvent', () => getActiveEvent(userDataPath));
  ipcMain.handle('event:list', () => listEvents(userDataPath));
  ipcMain.handle('event:save', (_event, input: unknown) => saveEventSettings(userDataPath, input));
  ipcMain.handle('event:duplicate', (_event, eventId: unknown) => duplicateEvent(userDataPath, eventId));
  ipcMain.handle('event:activate', (_event, eventId: unknown) => selectActiveEvent(userDataPath, eventId));
  ipcMain.handle('event:logoData', (_event, eventId: unknown) => getEventLogoDataUrl(userDataPath, eventId));
  ipcMain.handle('event:chooseLogo', async (_event, eventId: unknown) => {
    if (typeof eventId !== 'string') throw new Error('Invalid event');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Logo image', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    setEventLogo(userDataPath, eventId, result.filePaths[0]);
    return getEventLogoDataUrl(userDataPath, eventId);
  });
  ipcMain.handle('uploadQueue:list', () => listUploadQueue(userDataPath));
  ipcMain.handle('uploadQueue:enqueueSession', (_event, sessionId: unknown) => enqueueSessionFiles(userDataPath, sessionId));
  ipcMain.handle('download:createShareLink', (_event, sessionId: unknown) => {
    if (!downloadServer) throw new Error('The private download service is not running. Restart the booth app.');
    const baseUrl = readBoothSetting(userDataPath, 'downloadBaseUrl');
    if (!baseUrl) throw new Error('Set the public HTTPS download URL in the booth settings first.');
    return createSessionShareLink(userDataPath, sessionId, baseUrl);
  });
  ipcMain.handle('printer:list', async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!owner || owner.isDestroyed()) return [];
    const printers = await owner.webContents.getPrintersAsync();
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName }));
  });
  ipcMain.handle('printer:printOutput', async (_event, sessionId: unknown, printerName: unknown) => {
    if (typeof printerName !== 'string' || !printerName.trim() || printerName.length > 256) throw new Error('Choose a valid printer');
    const printInfo = getLatestSessionPrintInfo(userDataPath, sessionId);
    const printer = new ElectronSystemPrinter();
    return printer.printImage(printInfo.imagePath, { printerName, ...pageSizeMicrons(printInfo.width, printInfo.height) });
  });
  ipcMain.handle('session:exportEvent', async (_event, eventId: unknown) => {
    if (typeof eventId !== 'string') throw new Error('Invalid event');
    const selection = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return exportEventFolder(userDataPath, eventId, selection.filePaths[0]);
  });
  ipcMain.handle('session:checkDiskSpace', async (_event, thresholdGB: unknown) => {
    if (typeof thresholdGB !== 'number' || !Number.isFinite(thresholdGB) || thresholdGB < 0 || thresholdGB > MAX_DISK_WARNING_GB) throw new Error('Invalid disk warning threshold');
    const { photosDirectory } = getConfiguredStoragePaths(userDataPath);
    const stats = fs.statfsSync(photosDirectory);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!isBelowDiskWarningThreshold(freeBytes, thresholdGB)) return true;
    const options = {
      type: 'warning' as const, title: 'Low disk space', buttons: ['Continue anyway', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Only ${(freeBytes / BYTES_PER_GIGABYTE).toFixed(2)} GB is free on the photo drive.`,
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

  mainWindow = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('before-quit', () => { if (downloadServer) downloadServer.close(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
