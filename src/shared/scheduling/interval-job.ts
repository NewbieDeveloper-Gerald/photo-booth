import { toErrorMessage } from '../errors';

export type IntervalJobOptions = {
  run: () => Promise<void>;
  intervalMs: number;
  /** Reported instead of thrown: a failing background job must never take the booth down. */
  onError?: (message: string) => void;
  /** Default true: catch up on whatever was missed while the app was closed. */
  runImmediately?: boolean;
};

/**
 * Runs a background job on a timer without ever overlapping two runs, and unrefs the
 * timer so a pending run cannot keep the booth from quitting. Shared by the upload queue
 * and the retention sweep, which have the same safety requirements.
 */
export function startIntervalJob({ run, intervalMs, onError = () => {}, runImmediately = true }: IntervalJobOptions): () => void {
  let isRunning = false;
  let isStopped = false;
  const tick = async (): Promise<void> => {
    if (isRunning || isStopped) return;
    isRunning = true;
    try { await run(); }
    catch (error) { onError(toErrorMessage(error, 'Background job failed')); }
    finally { isRunning = false; }
  };
  if (runImmediately) void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => { isStopped = true; clearInterval(timer); };
}
