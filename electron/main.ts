import { app, BrowserWindow, session } from 'electron';
import type { Server } from 'node:http';
import { initializeStorage } from '../src/features/storage/node.js';
import { ensureBuiltinTemplates } from '../src/features/layouts/node.js';
import { mockUploadAdapter, recoverInterruptedUploads, startUploadScheduler } from '../src/features/sharing/node.js';
import { registerIpcHandlers } from './ipc/registry.js';
import { startDownloadServer } from './download-service.js';
import { createBoothWindowController } from './windows/booth-window.js';

const boothWindow = createBoothWindowController();
let mainWindow: BrowserWindow | null = null;
let downloadServer: Server | null = null;

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  initializeStorage(userDataPath);
  ensureBuiltinTemplates(userDataPath);
  recoverInterruptedUploads(userDataPath);
  // Background sync (F14): resumes queued uploads at startup and retries with backoff.
  const stopUploadScheduler = startUploadScheduler({ userDataPath, adapter: mockUploadAdapter, onError: (message) => console.warn(message) });
  app.on('will-quit', stopUploadScheduler);
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
