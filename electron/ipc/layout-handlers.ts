import { BrowserWindow, dialog, ipcMain } from 'electron';
import { createTemplate, deleteTemplate, duplicateTemplate, listTemplates, loadTemplate, renameTemplate, saveTemplate } from '../../src/features/layouts/node.js';
import { readLayoutAsset, saveLayoutAsset } from '../../src/features/layouts/data/layout-assets.js';
import type { IpcContext } from './context.js';

export function registerLayoutHandlers({ userDataPath, getMainWindow }: IpcContext): void {
  ipcMain.handle('layouts:list', () => listTemplates(userDataPath));
  ipcMain.handle('layouts:get', (_event, templateId: unknown) => {
    if (typeof templateId !== 'string' || !templateId) throw new Error('Choose a layout');
    return loadTemplate(userDataPath, templateId);
  });
  ipcMain.handle('layouts:save', (_event, document: unknown) => {
    saveTemplate(userDataPath, document as Parameters<typeof saveTemplate>[1]);
    return listTemplates(userDataPath);
  });
  ipcMain.handle('layouts:create', (_event, request: unknown) => {
    const { pageId, shots, name } = request as { pageId: '4x6'; shots: number; name: string };
    return createTemplate(userDataPath, { pageId, shots: Number(shots), name: String(name ?? '') });
  });
  ipcMain.handle('layouts:duplicate', (_event, templateId: unknown, name: unknown) =>
    duplicateTemplate(userDataPath, String(templateId), typeof name === 'string' ? name : undefined));
  ipcMain.handle('layouts:delete', (_event, templateId: unknown) => {
    deleteTemplate(userDataPath, String(templateId));
    return listTemplates(userDataPath);
  });
  ipcMain.handle('layouts:rename', (_event, templateId: unknown, name: unknown) => {
    renameTemplate(userDataPath, String(templateId), String(name ?? ''));
    return listTemplates(userDataPath);
  });
  ipcMain.handle('layouts:pickAsset', async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    const options = {
      title: 'Choose layout artwork',
      properties: ['openFile' as const],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    };
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths[0]) return null;
    return saveLayoutAsset(userDataPath, selection.filePaths[0]);
  });
  ipcMain.handle('layouts:readAsset', (_event, assetName: unknown) => readLayoutAsset(userDataPath, assetName));
}
