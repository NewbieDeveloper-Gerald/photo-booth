import { ipcMain } from 'electron';
import { listTemplates, loadTemplate } from '../../src/features/layouts/node.js';
import type { IpcContext } from './context.js';

export function registerLayoutHandlers({ userDataPath }: IpcContext): void {
  ipcMain.handle('layouts:list', () => listTemplates(userDataPath));
  ipcMain.handle('layouts:get', (_event, templateId: unknown) => {
    if (typeof templateId !== 'string' || !templateId) throw new Error('Choose a layout');
    return loadTemplate(userDataPath, templateId);
  });
}
