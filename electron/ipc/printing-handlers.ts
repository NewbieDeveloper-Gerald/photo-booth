import { BrowserWindow, ipcMain } from 'electron';
import {
  cancelPrintJob, deletePrinterProfile, enqueuePrintJob, getPrinterProfile, getPrintQueueSummary, listPrintJobs,
  listPrinterProfiles, markPrinterProfileChecked, reprintPrintJob, savePrinterProfile, setPrintQueuePaused,
} from '../../src/features/printing/node.js';
import { describeProfile } from '../../src/features/printing/index.js';
import { printTestSheet } from '../windows/print-window.js';
import type { IpcContext } from './context.js';

export function registerPrintingHandlers({ userDataPath, getMainWindow, wakePrintQueue }: IpcContext): void {
  ipcMain.handle('printer:list', async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    if (!owner || owner.isDestroyed()) return [];
    const printers = await owner.webContents.getPrintersAsync();
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName }));
  });
  // Printing goes through the queue (F18) so jobs survive a pause, a failure or a restart.
  ipcMain.handle('print:enqueue', (_event, sessionId: unknown, printerName: unknown) => {
    const job = enqueuePrintJob(userDataPath, sessionId, printerName);
    wakePrintQueue();
    return job;
  });
  ipcMain.handle('print:reprint', (_event, jobId: unknown) => {
    const job = reprintPrintJob(userDataPath, jobId);
    wakePrintQueue();
    return job;
  });
  ipcMain.handle('print:list', (_event, eventId: unknown) => listPrintJobs(userDataPath, typeof eventId === 'string' ? eventId : undefined));
  ipcMain.handle('print:summary', (_event, eventId: unknown) => getPrintQueueSummary(userDataPath, eventId));
  ipcMain.handle('print:pause', (_event, paused: unknown) => {
    const result = setPrintQueuePaused(userDataPath, paused);
    wakePrintQueue();
    return result;
  });
  ipcMain.handle('print:cancel', (_event, jobId: unknown) => cancelPrintJob(userDataPath, jobId));

  // Printer profiles (F25): saved paper, cut and colour per printer model.
  ipcMain.handle('print:profiles', () => listPrinterProfiles(userDataPath));
  ipcMain.handle('print:profiles:save', (_event, draft: unknown) => savePrinterProfile(userDataPath, draft));
  ipcMain.handle('print:profiles:delete', (_event, profileId: unknown) => deletePrinterProfile(userDataPath, profileId));
  ipcMain.handle('print:profiles:checked', (_event, profileId: unknown, checked: unknown) => markPrinterProfileChecked(userDataPath, profileId, checked));
  /**
   * Prints the test sheet straight through the printer, not through the queue: it is a check of
   * the profile, not a guest's photo, so it must not spend a session's print allowance.
   */
  ipcMain.handle('print:profiles:test', async (_event, profileId: unknown, fallbackPrinterName: unknown) => {
    if (typeof profileId !== 'string') throw new Error('Invalid printer profile');
    const profile = getPrinterProfile(userDataPath, profileId);
    if (!profile) throw new Error('Printer profile not found');
    const printerName = profile.printerName || (typeof fallbackPrinterName === 'string' ? fallbackPrinterName.trim() : '');
    if (!printerName) throw new Error('Choose the printer to send the test sheet to');
    const result = await printTestSheet(profile, printerName);
    if (!result.success) throw new Error(result.error ?? 'The printer rejected the test sheet');
    return { printed: true, description: describeProfile(profile) };
  });
}
