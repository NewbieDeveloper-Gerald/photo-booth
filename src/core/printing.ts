export type AutoPrintEvent = { printEnabled: boolean };
export type AutoPrintDecision = { shouldPrint: boolean; status: string };

/** Decides whether finishing a session should send a print job without operator input. */
export function decideAutoPrint(event: AutoPrintEvent, printerName: string): AutoPrintDecision {
  if (!event.printEnabled) return { shouldPrint: false, status: 'Printing is turned off for this event.' };
  if (!printerName) return { shouldPrint: false, status: 'No printer selected. Choose one, then print.' };
  return { shouldPrint: true, status: '' };
}
