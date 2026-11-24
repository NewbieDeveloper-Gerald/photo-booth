import { MICRONS_PER_INCH, PRINT_DPI } from '../shared/constants/limits';

export type PrinterInfo = { name: string; displayName: string; isDefault: boolean; status: number };
export type PrintJobOptions = { printerName: string; widthMicrons: number; heightMicrons: number };
export type PrintResult = { success: boolean; error?: string };

export interface PrinterDevice {
  printImage(imagePath: string, options: PrintJobOptions): Promise<PrintResult>;
}

export class MockPrinter implements PrinterDevice {
  readonly jobs: Array<{ imagePath: string; options: PrintJobOptions }> = [];
  constructor(private readonly result: PrintResult = { success: true }) {}
  async printImage(imagePath: string, options: PrintJobOptions): Promise<PrintResult> {
    this.jobs.push({ imagePath, options });
    return this.result;
  }
}

export function pageSizeMicrons(widthPixels: number, heightPixels: number, dpi = PRINT_DPI): { widthMicrons: number; heightMicrons: number } {
  if (![widthPixels, heightPixels, dpi].every((value) => Number.isInteger(value) && value > 0)) throw new RangeError('Print dimensions and DPI must be positive integers');
  return { widthMicrons: Math.round(widthPixels / dpi * MICRONS_PER_INCH), heightMicrons: Math.round(heightPixels / dpi * MICRONS_PER_INCH) };
}
