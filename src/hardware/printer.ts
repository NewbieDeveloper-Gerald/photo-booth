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

export function pageSizeMicrons(widthPixels: number, heightPixels: number, dpi = 300): { widthMicrons: number; heightMicrons: number } {
  if (![widthPixels, heightPixels, dpi].every((value) => Number.isInteger(value) && value > 0)) throw new RangeError('Print dimensions and DPI must be positive integers');
  return { widthMicrons: Math.round(widthPixels / dpi * 25_400), heightMicrons: Math.round(heightPixels / dpi * 25_400) };
}
