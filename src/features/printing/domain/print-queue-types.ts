/** Print-queue vocabulary shared by the booth screen and the main-process worker. */
export type PrintJobStatus = 'queued' | 'printing' | 'done' | 'failed' | 'cancelled';

export type PrintJob = {
  id: string;
  sessionId: string;
  eventId: string;
  printerName: string;
  status: PrintJobStatus;
  attempts: number;
  error: string | null;
  createdAt: string;
};

export type PrintQueueSummary = {
  queued: number;
  printing: number;
  done: number;
  failed: number;
  paused: boolean;
  /** Sheets allowed for this event; 0 means the operator has not entered a paper count. */
  paperCount: number;
  /** Per-session cap on prints, reprints included. */
  sessionLimit: number;
  /** Set once the event total reaches the paper count; the booth keeps printing but warns. */
  paperWarning: string | null;
};

/** A print job ready to be sent: where the image is and how big the sheet is. */
export type PrintableSession = { imagePath: string; width: number; height: number };

/** The bit of a printer the queue needs; the Electron device and the mock both fit it. */
export type PrintQueuePrinter = {
  printImage(imagePath: string, options: { printerName: string; widthMicrons: number; heightMicrons: number }): Promise<{ success: boolean; error?: string }>;
};

export type PrintQueueScheduler = {
  /** Kicks the queue now — used right after an enqueue so printing does not wait for a tick. */
  wake: () => void;
  stop: () => void;
};
