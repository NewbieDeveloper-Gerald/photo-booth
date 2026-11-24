import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { buildImagePrintDocument, buildTestPrintDocument, type PrintDocumentOptions } from '../../src/features/printing/domain/print-document.js';
import { printSheet, resolveProfileDetails, type PrinterProfile } from '../../src/features/printing/domain/printer-profile.js';
import { paperSizeMicrons } from '../../src/features/printing/domain/printer-models.js';

export type { PrintDocumentOptions };

/** Builds the silent-print document: one image, exact page size, no margins, no scaling. */
export async function buildPrintDocument(imagePath: string, options: PrintDocumentOptions): Promise<string> {
  const bytes = await fs.readFile(imagePath);
  return buildImagePrintDocument(`data:image/jpeg;base64,${bytes.toString('base64')}`, options);
}

/** Sends an HTML document to a named Windows printer through a hidden window. */
export function printHtml(html: string, printerName: string, options: PrintDocumentOptions): Promise<{ success: boolean; error?: string }> {
  const printWindow = new BrowserWindow({
    show: false,
    width: 600,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  return (async () => {
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await printWindow.webContents.executeJavaScript('document.querySelector("img")?.decode?.() ?? Promise.resolve()');
      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        printWindow.webContents.print({
          silent: true,
          deviceName: printerName,
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
  })();
}

/**
 * Prints the profile's test sheet (F25): the sheet carries the settings being tested, so the
 * operator can check margins, grey ramp, colour patches and hairlines on the real printer.
 */
export async function printTestSheet(profile: PrinterProfile, printerName: string): Promise<{ success: boolean; error?: string }> {
  const resolved = resolveProfileDetails(profile);
  const size = resolved ? printSheet(resolved) : paperSizeMicrons({ id: 'fallback', label: '4 × 6 in', widthMm: 101.6, heightMm: 152.4 });
  return printHtml(buildTestPrintDocument(profile), printerName, size);
}
