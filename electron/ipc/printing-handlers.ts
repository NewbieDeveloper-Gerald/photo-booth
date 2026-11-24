import { BrowserWindow, ipcMain } from 'electron';
import {
  cancelPrintJob, enqueuePrintJob, getPrintQueueSummary, listPrintJobs, reprintPrintJob, setPrintQueuePaused,
} from '../../src/features/printing/node.js';
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
}
