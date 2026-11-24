import { BrowserWindow, ipcMain } from 'electron';
import { ElectronSystemPrinter } from '../devices/system-printer.js';
import { getLatestSessionPrintInfo, pageSizeMicrons } from '../../src/features/printing/index.js';
import type { IpcContext } from './context.js';

const MAX_PRINTER_NAME_LENGTH = 256;

export function registerPrintingHandlers({ userDataPath, getMainWindow }: IpcContext): void {
  ipcMain.handle('printer:list', async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    if (!owner || owner.isDestroyed()) return [];
    const printers = await owner.webContents.getPrintersAsync();
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName }));
  });
  ipcMain.handle('printer:printOutput', async (_event, sessionId: unknown, printerName: unknown) => {
    if (typeof printerName !== 'string' || !printerName.trim() || printerName.length > MAX_PRINTER_NAME_LENGTH) {
      throw new Error('Choose a valid printer');
    }
    const printInfo = getLatestSessionPrintInfo(userDataPath, sessionId);
    return new ElectronSystemPrinter().printImage(printInfo.imagePath, {
      printerName,
      ...pageSizeMicrons(printInfo.width, printInfo.height),
    });
  });
}
