import { PRINT_QUEUE_INTERVAL_MS } from '../../shared/constants/limits';
import { toErrorMessage } from '../../shared/errors';
import { processNextPrintJob } from './data/print-queue-repository';
import type { PrintJob, PrintQueuePrinter, PrintQueueScheduler } from './domain/print-queue-types';

/** A backlog is drained a few sheets at a time so one tick cannot hog the main process. */
const MAX_JOBS_PER_RUN = 10;

type PrintQueueSchedulerOptions = {
  userDataPath: string;
  printer: PrintQueuePrinter;
  intervalMs?: number;
  onError?: (message: string) => void;
  /** One job, injected so tests can drive the loop without a database or a printer. */
  runOnce?: () => Promise<PrintJob | null>;
};

/**
 * The print worker (F18): looks for a queued job every few seconds and, unlike a fire-and-forget
 * print, keeps a failed sheet in the list so the operator can retry or cancel it. A pause is
 * honoured by `processNextPrintJob`, so the loop can simply keep ticking.
 */
export function startPrintQueueScheduler({
  userDataPath,
  printer,
  intervalMs = PRINT_QUEUE_INTERVAL_MS,
  onError = () => {},
  runOnce = () => processNextPrintJob(userDataPath, printer),
}: PrintQueueSchedulerOptions): PrintQueueScheduler {
  let stopped = false;
  let running = false;
  let again = false;

  const pump = async (): Promise<void> => {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    try {
      for (let count = 0; count < MAX_JOBS_PER_RUN && !stopped; count += 1) {
        if (!(await runOnce())) break;
      }
    } catch (error) {
      // A broken job must not stop the queue; it is reported and the next tick tries again.
      onError(toErrorMessage(error, 'Print queue failed'));
    } finally {
      running = false;
      if (again && !stopped) { again = false; void pump(); }
    }
  };

  void pump();
  const timer = setInterval(() => void pump(), intervalMs);
  timer.unref?.();
  return {
    wake: () => void pump(),
    stop: () => { stopped = true; clearInterval(timer); },
  };
}
