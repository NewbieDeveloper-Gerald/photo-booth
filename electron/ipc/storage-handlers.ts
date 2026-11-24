import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import { getConfiguredStoragePaths } from '../../src/features/storage/node.js';
import { isBelowDiskWarningThreshold } from '../../src/features/storage/node.js';
import { exportEventFolder } from '../../src/features/events/node.js';
import { BYTES_PER_GIGABYTE, MAX_DISK_WARNING_GB } from '../../src/shared/constants/limits.js';
import type { IpcContext } from './context.js';

export function registerStorageHandlers({ userDataPath }: IpcContext): void {
  ipcMain.handle('session:exportEvent', async (_event, eventId: unknown) => {
    if (typeof eventId !== 'string') throw new Error('Invalid event');
    const selection = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return exportEventFolder(userDataPath, eventId, selection.filePaths[0]);
  });
  ipcMain.handle('session:checkDiskSpace', async (_event, thresholdGB: unknown) => {
    if (typeof thresholdGB !== 'number' || !Number.isFinite(thresholdGB) || thresholdGB < 0 || thresholdGB > MAX_DISK_WARNING_GB) {
      throw new Error('Invalid disk warning threshold');
    }
    const { photosDirectory } = getConfiguredStoragePaths(userDataPath);
    const stats = fs.statfsSync(photosDirectory);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!isBelowDiskWarningThreshold(freeBytes, thresholdGB)) return true;
    const options = {
      type: 'warning' as const, title: 'Low disk space', buttons: ['Continue anyway', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Only ${(freeBytes / BYTES_PER_GIGABYTE).toFixed(2)} GB is free on the photo drive.`,
      detail: `The warning threshold is ${thresholdGB} GB. Continue only if you have enough room for this session.`,
    };
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const response = focusedWindow ? await dialog.showMessageBox(focusedWindow, options) : await dialog.showMessageBox(options);
    return response.response === 0;
  });
}
