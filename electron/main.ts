import { app, BrowserWindow, session } from 'electron';
import type { Server } from 'node:http';
import { initializeStorage } from '../src/features/storage/node.js';
import { ensureBuiltinTemplates } from '../src/features/layouts/node.js';
import { mockUploadAdapter, recoverInterruptedUploads, startUploadScheduler } from '../src/features/sharing/node.js';
import { startRetentionScheduler } from '../src/features/retention/node.js';
import { startPrintQueueScheduler } from '../src/features/printing/node.js';
import { registerIpcHandlers } from './ipc/registry.js';
import { startDownloadServer } from './download-service.js';
import { startRemoteGuestService } from './remote-service.js';
import type { RemoteGuestService } from './remote-service.js';
import { ElectronSystemPrinter } from './devices/system-printer.js';
import { startDslrService } from './dslr-service.js';
import type { DslrService } from './dslr-service.js';
import { createBoothWindowController } from './windows/booth-window.js';

const boothWindow = createBoothWindowController();
let mainWindow: BrowserWindow | null = null;
let downloadServer: Server | null = null;
let remoteGuest: RemoteGuestService | null = null;
let dslr: DslrService | null = null;

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  initializeStorage(userDataPath);
  ensureBuiltinTemplates(userDataPath);
  recoverInterruptedUploads(userDataPath);
  // Background sync (F14): resumes queued uploads at startup and retries with backoff.
  const stopUploadScheduler = startUploadScheduler({ userDataPath, adapter: mockUploadAdapter, onError: (message) => console.warn(message) });
  app.on('will-quit', stopUploadScheduler);
  // Daily retention sweep (F15): expired guest links take their photos with them.
  const stopRetentionScheduler = startRetentionScheduler({ userDataPath, onError: (message) => console.warn(message) });
  app.on('will-quit', stopRetentionScheduler);
  downloadServer = await startDownloadServer(userDataPath);
  // The tablet guest screen (F22): started now, switched on by the operator, token in the URL.
  remoteGuest = await startRemoteGuestService({
    userDataPath,
    onClientsChanged: () => {
      const info = remoteGuest?.info();
      if (info) mainWindow?.webContents.send('remote:status', info);
    },
  });

  // The print worker (F18): queued sheets print in order, retried after a pause or a restart.
  const printQueue = startPrintQueueScheduler({
    userDataPath, printer: new ElectronSystemPrinter(), onError: (message) => console.warn(message),
  });
  app.on('will-quit', printQueue.stop);

  // The tether camera (F26): the helper only runs while live view or a capture asks for it.
  dslr = startDslrService(() => mainWindow);
  app.on('will-quit', () => dslr?.dispose());

  registerIpcHandlers({
    userDataPath,
    wakePrintQueue: printQueue.wake,
    getMainWindow: () => mainWindow,
    getDownloadServer: () => downloadServer,
    requestAppQuit: () => {
      // A close only goes through once the controller allows it; the exit prompt already checked the PIN.
      boothWindow.permitClose();
      app.quit();
    },
  }, remoteGuest, dslr);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow = boothWindow.create();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = boothWindow.create();
  });
});

app.on('before-quit', () => {
  if (downloadServer) downloadServer.close();
  void remoteGuest?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
