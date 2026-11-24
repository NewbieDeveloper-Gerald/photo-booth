import { ipcMain } from 'electron';
import { readBoothSetting } from '../../src/features/storage/node.js';
import { createSessionShareLink } from '../../src/features/sharing/node.js';
import { enqueueSessionFiles, listUploadQueue, skipPendingUploads } from '../../src/features/sharing/node.js';
import { createEventGalleryLink, setGalleryPassword } from '../../src/features/sharing/node.js';
import { mockLinkSender, sendSessionLink, webhookLinkSender } from '../../src/features/sharing/node.js';
import type { IpcContext } from './context.js';

/**
 * The sender is chosen once, from configuration, and never persisted with a guest's address:
 * an operator gateway if they set one up, the demo sender otherwise (F28).
 */
const linkSender = (() => {
  const webhook = process.env.PHOTOBOOTH_LINK_WEBHOOK?.trim();
  return webhook ? webhookLinkSender(webhook, (url, init) => fetch(url, init)) : mockLinkSender();
})();

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
  // F28: hand the finished link to the guest's email or phone. The booth validates, sends and
  // forgets the address — nothing about the target is stored.
  ipcMain.handle('share:sendLink', async (_event, sessionId: unknown, channel: unknown, target: unknown) => {
    const baseUrl = readBoothSetting(userDataPath, 'downloadBaseUrl');
    if (!baseUrl) throw new Error('Set the public HTTPS download URL in the booth settings first');
    return sendSessionLink({ userDataPath, sessionId, channel, target, baseUrl, sender: linkSender });
  });
  ipcMain.handle('download:createShareLink', (_event, sessionId: unknown) => {
    if (!getDownloadServer()) throw new Error('The private download service is not running. Restart the booth app.');
    const baseUrl = readBoothSetting(userDataPath, 'downloadBaseUrl');
    if (!baseUrl) throw new Error('Set the public HTTPS antibody URL in the booth settings first.');
    return createSessionShareLink(userDataPath, sessionId, baseUrl);
  });
}
