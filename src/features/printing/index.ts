/** Renderer-safe surface; the data layer lives in ./node.ts. */
export { decideAutoPrint, type AutoPrintDecision, type AutoPrintEvent } from './domain/auto-print';
export { MockPrinter, pageSizeMicrons, type PrintJobOptions, type PrintResult, type PrinterDevice, type PrinterInfo } from './devices/printer';
