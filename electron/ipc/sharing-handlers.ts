import { ipcMain } from 'electron';
import { readBoothSetting } from '../../src/features/storage/node.js';
import { createSessionShareLink } from '../../src/features/sharing/node.js';
import { enqueueSessionFiles, listUploadQueue, skipPendingUploads } from '../../src/features/sharing/node.js';
import { createEventGalleryLink, setGalleryPassword } from '../../src/features/sharing/node.js';
import type { IpcContext } from './context.js';

export function registerSharingHandlers({ userDataPath, getDownloadServer }: IpcContext): void {
  ipcMain.handle('uploadQueue:list', () => listUploadQueue(userDataPath));
  ipcMain.handle('uploadQueue:enqueueSession', (_event, sessionId: unknown) => enqueueSessionFiles(userDataPath, sessionId));
  // Operator key (F21): stop counting the waiting sync files without deleting anything.
  ipcMain.handle('uploadQueue:skipPending', (_event, sessionId: unknown) => skipPendingUploads(userDataPath, sessionId));
  ipcMain.handle('gallery:createLink', (_event, eventId: unknown) => {
    const baseUrl = readBoothSetting(userDataPath, 'downloadBaseUrl');
    if (!baseUrl) throw new Error('Set the public HTTPS download URL in the booth settings first');
    return createEventGalleryLink(userDataPath, eventId, baseUrl);
  });
  ipcMain.handle('gallery:setPassword', (_event, eventId: unknown, password: unknown) => setGalleryPassword(userDataPath, eventId, password));
  ipcMain.handle('download:createShareLink', (_event, sessionId: unknown) => {
    if (!getDownloadServer()) throw new Error('The private download service is not running. Restart the booth app.');
    const baseUrl = readBoothSetting(userDataPath, 'downloadBaseUrl');
    if (!baseUrl) throw new Error('Set the public HTTPS antibody URL in the booth settings first.');
    return createSessionShareLink(userDataPath, sessionId, baseUrl);
  });
}
