/** Renderer-safe surface; the data layer lives in ./node.ts. */
export { decideAutoPrint, type AutoPrintDecision, type AutoPrintEvent } from './domain/auto-print';
export type { PrintJob, PrintJobStatus, PrintQueuePrinter, PrintQueueSummary } from './domain/print-queue-types';
export { MockPrinter, pageSizeMicrons, type PrintJobOptions, type PrintResult, type PrinterDevice, type PrinterInfo } from './devices/printer';
