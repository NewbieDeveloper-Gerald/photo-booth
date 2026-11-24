/** Renderer-safe surface; the data layer lives in ./node.ts. */
export { decideAutoPrint, type AutoPrintDecision, type AutoPrintEvent } from './domain/auto-print';
export type { PrintJob, PrintJobStatus, PrintQueuePrinter, PrintQueueSummary } from './domain/print-queue-types';
export { MockPrinter, pageSizeMicrons, type PrintJobOptions, type PrintResult, type PrinterDevice, type PrinterInfo } from './devices/printer';
export {
  CUT_MODE_LABELS, PAPER_SIZES, PRINTER_MODELS, findPaperSize, findPrinterModel, paperSizeMicrons,
  type CutMode, type PaperSize, type PrinterModel,
} from './domain/printer-models';
export {
  COLOR_MODE_LABELS, MAX_COLOR_ADJUSTMENT_PERCENT, MAX_PRINTER_NAME_LENGTH, MAX_PROFILE_NAME_LENGTH,
  describeProfile, imageFilter, isProfileVerified, printSheet, resolvePrinterProfile, resolveProfileDetails,
  validatePrinterProfileDraft, verificationLabel,
  type ColorMode, type PrinterProfile, type PrinterProfileDraft, type ResolvedProfile,
} from './domain/printer-profile';
export { buildImagePrintDocument, buildTestPrintDocument, type PrintDocumentOptions } from './domain/print-document';
