import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import type { PrintJobOptions, PrintResult, PrinterDevice } from '../src/hardware/printer.js';

export class ElectronSystemPrinter implements PrinterDevice {
  async printImage(imagePath: string, options: PrintJobOptions): Promise<PrintResult> {
    const bytes = await fs.readFile(imagePath);
    const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    const widthInches = options.widthMicrons / 25_400;
    const heightInches = options.heightMicrons / 25_400;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:${widthInches}in ${heightInches}in;margin:0}
      *{box-sizing:border-box}html,body{width:${widthInches}in;height:${heightInches}in;margin:0;padding:0;overflow:hidden}
      img{display:block;width:100%;height:100%;object-fit:fill}
      </style></head><body><img src="${dataUrl}" alt="Photobooth print"></body></html>`;
    const printWindow = new BrowserWindow({
      show: false,
      width: 600,
      height: 900,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await printWindow.webContents.executeJavaScript('document.querySelector("img").decode()');
      return await new Promise<PrintResult>((resolve) => {
        printWindow.webContents.print({
          silent: true,
          deviceName: options.printerName,
          printBackground: true,
          pageSize: { width: options.widthMicrons, height: options.heightMicrons },
          margins: { marginType: 'none' },
          scaleFactor: 100,
          landscape: options.widthMicrons > options.heightMicrons,
        }, (success, failureReason) => resolve(success ? { success: true } : { success: false, error: failureReason || 'The printer rejected the job.' }));
      });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Could not send the print job.' };
    } finally {
      if (!printWindow.isDestroyed()) printWindow.close();
    }
  }
}
