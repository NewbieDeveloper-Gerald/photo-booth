import type { PrintJobOptions, PrintResult, PrinterDevice } from '../../src/features/printing/index.js';
import { buildPrintDocument, printHtml } from '../windows/print-window.js';

/** Prints through the Windows print system (Electron's silent print) behind the PrinterDevice seam. */
export class ElectronSystemPrinter implements PrinterDevice {
  async printImage(imagePath: string, options: PrintJobOptions): Promise<PrintResult> {
    const document = await buildPrintDocument(imagePath, options);
    return printHtml(document, options.printerName, options);
  }
}
