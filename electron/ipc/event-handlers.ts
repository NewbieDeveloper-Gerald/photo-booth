import { dialog, ipcMain } from 'electron';
import {
  duplicateEvent, getActiveEvent, getEventLogoDataUrl, listEvents, saveEventSettings, selectActiveEvent, setEventLogo,
} from '../../src/features/events/node.js';
import type { IpcContext } from './context.js';

export function registerEventHandlers({ userDataPath }: IpcContext): void {
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
}
