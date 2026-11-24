import { app, BrowserWindow, session } from 'electron';
import type { Server } from 'node:http';
import { initializeStorage } from '../src/features/storage/index.js';
import { recoverInterruptedUploads } from '../src/features/sharing/index.js';
import { registerIpcHandlers } from './ipc/registry.js';
import { startDownloadServer } from './download-service.js';
import { createBoothWindowController } from './windows/booth-window.js';

const boothWindow = createBoothWindowController();
let mainWindow: BrowserWindow | null = null;
let downloadServer: Server | null = null;

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  initializeStorage(userDataPath);
  recoverInterruptedUploads(userDataPath);
  downloadServer = await startDownloadServer(userDataPath);

  registerIpcHandlers({
    userDataPath,
    getMainWindow: () => mainWindow,
    getDownloadServer: () => downloadServer,
    requestAppQuit: () => {
      // A close only goes through once the controller allows it; the exit prompt already checked the PIN.
      boothWindow.permitClose();
      app.quit();
    },
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow = boothWindow.create();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = boothWindow.create();
  });
});

app.on('before-quit', () => { if (downloadServer) downloadServer.close(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
