import { app, BrowserWindow, dialog, session } from 'electron';
import path from 'node:path';
import type { Server } from 'node:http';
import { DATABASE_FILE_NAME, initializeStorage } from '../src/features/storage/node.js';
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
import { startAndroidUsbService } from './android-usb-service.js';
import { readRemoteToken } from '../src/features/remote-guest/node.js';
import type { DslrService } from './dslr-service.js';
import { createBoothWindowController } from './windows/booth-window.js';

const boothWindow = createBoothWindowController();
let mainWindow: BrowserWindow | null = null;
let downloadServer: Server | null = null;
let remoteGuest: RemoteGuestService | null = null;
let dslr: DslrService | null = null;

/**
 * A failure this early has no window to show it in, and an unhandled rejection leaves a blank
 * window and a stack trace in the terminal — which is exactly how the `table templates already
 * exists` upgrade failure looked. Say what went wrong, where the database is, and stop.
 */
function reportStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const databasePath = path.join(app.getPath('userData'), DATABASE_FILE_NAME);
  console.error(error);
  dialog.showErrorBox('The photo booth could not start', `${message}\n\nDatabase: ${databasePath}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const repaired = initializeStorage(userDataPath);
  // An older database already had part of the schema; it is recorded as applied now.
  for (const repair of repaired) console.warn(`schema repaired: ${repair}`);
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

  // The USB cable link (F22 extension): adb reverse maps the tablet port, so a phone on a cable
  // shows the guest screen with no internet, no router and no typing.
  const usbLink = startAndroidUsbService(() => readRemoteToken(userDataPath));

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
  }, remoteGuest, dslr, usbLink);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow = boothWindow.create();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = boothWindow.create();
  });
}).catch(reportStartupFailure);

app.on('before-quit', () => {
  if (downloadServer) downloadServer.close();
  void remoteGuest?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
