import { dialog, ipcMain } from 'electron';
import {
  addAttractMedia, duplicateEvent, getActiveEvent, getEventLogoDataUrl, listAttractMedia, listEvents, readAttractMedia,
  removeAttractMedia, saveEventSettings, selectActiveEvent, setEventLogo,
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
  // Attract screen media (F19): files are copied into the event's own folder, never linked.
  ipcMain.handle('attract:list', (_event, eventId: unknown) => listAttractMedia(userDataPath, eventId));
  ipcMain.handle('attract:add', async (_event, eventId: unknown) => {
    if (typeof eventId !== 'string') throw new Error('Invalid event');
    const result = await dialog.showOpenDialog({
      title: 'Attract screen photos and videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Photos and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'm4v', 'webm'] },
        { name: 'Photos', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'Videos', extensions: ['mp4', 'm4v', 'webm'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return listAttractMedia(userDataPath, eventId);
    return addAttractMedia(userDataPath, eventId, result.filePaths);
  });
  ipcMain.handle('attract:remove', (_event, eventId: unknown, mediaId: unknown) => removeAttractMedia(userDataPath, eventId, mediaId));
  ipcMain.handle('attract:read', (_event, eventId: unknown, mediaId: unknown) => {
    const media = readAttractMedia(userDataPath, eventId, mediaId);
    return { kind: media.kind, mimeType: media.mimeType, bytes: media.bytes };
  });
}
