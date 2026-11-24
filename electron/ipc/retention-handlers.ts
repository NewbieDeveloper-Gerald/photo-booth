import { ipcMain } from 'electron';
import { deleteEventPermanently, deleteSessionPermanently, readRetentionStatus } from '../../src/features/retention/node.js';
import type { IpcContext } from './context.js';

export function registerRetentionHandlers({ userDataPath }: IpcContext): void {
  ipcMain.handle('retention:deleteSession', (_event, sessionId: unknown) => deleteSessionPermanently(userDataPath, sessionId));
  ipcMain.handle('retention:deleteEvent', (_event, eventId: unknown) => deleteEventPermanently(userDataPath, eventId));
  ipcMain.handle('retention:status', () => readRetentionStatus(userDataPath));
}
