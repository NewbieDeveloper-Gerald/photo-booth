import { ipcMain } from 'electron';
import {
  abandonSession, commitRetake, createSession, discardSession, listUnfinishedSessions, loadSession,
  readOriginalPhoto, revertRetake, saveDownloadCopy, saveOriginalPhoto, saveRetakeOriginalPhoto, savePrintSheet, saveSessionAnimation, saveSessionOutput,
} from '../../src/features/capture/node.js';
import { setActiveEventRetakeLimit } from '../../src/features/events/node.js';
import type { IpcContext } from './context.js';

export function registerSessionHandlers({ userDataPath }: IpcContext): void {
  ipcMain.handle('session:setRetakeLimit', (_event, limit: unknown) => setActiveEventRetakeLimit(userDataPath, limit));
  ipcMain.handle('session:create', (_event, layoutId: unknown, filterId: unknown) => createSession(userDataPath, layoutId, filterId));
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
  ipcMain.handle('session:savePrintSheet', (_event, sessionId: unknown, bytes: unknown, width: unknown, height: unknown) =>
    savePrintSheet(userDataPath, sessionId, bytes, width, height));
  // F23: the animated extra is stored like any other output, so the guest page lists it.
  ipcMain.handle('session:saveAnimation', (_event, sessionId: unknown, bytes: unknown, kind: unknown) =>
    saveSessionAnimation(userDataPath, sessionId, bytes, kind));
  ipcMain.handle('session:saveOutput', (_event, sessionId: unknown, bytes: unknown, width: unknown, height: unknown) =>
    saveSessionOutput(userDataPath, sessionId, bytes, width, height));
  ipcMain.handle('session:abandon', (_event, sessionId: unknown) => abandonSession(userDataPath, sessionId));
  ipcMain.handle('session:discard', (_event, sessionId: unknown) => discardSession(userDataPath, sessionId));
}
