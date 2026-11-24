import { UPLOAD_SYNC_INTERVAL_MS } from '../../../shared/constants/limits';
import { toErrorMessage } from '../../../shared/errors';
import { processDueUploads } from './repository';
import type { UploadAdapter, UploadTickResult } from './types';

type UploadSchedulerOptions = {
  userDataPath: string;
  adapter: UploadAdapter;
  intervalMs?: number;
  /** Reported instead of thrown: a failed sync must never take the booth down. */
  onError?: (message: string) => void;
  /** The batch runner, injected so tests can drive ticks without a database. */
  runBatch?: (userDataPath: string, adapter: UploadAdapter) => Promise<UploadTickResult>;
};

/**
 * Runs the queue in the background: once at startup (so uploads queued before the app was
 * closed resume immediately) and then on a timer. Ticks never overlap, and the timer is
 * unref'd so a pending sync cannot keep the booth from quitting.
 */
export function startUploadScheduler({
  userDataPath,
  adapter,
  intervalMs = UPLOAD_SYNC_INTERVAL_MS,
  onError = () => {},
  runBatch = processDueUploads,
}: UploadSchedulerOptions): () => void {
  let isRunning = false;
  let isStopped = false;
  const tick = async (): Promise<void> => {
    if (isRunning || isStopped) return;
    isRunning = true;
    try { await runBatch(userDataPath, adapter); }
    catch (error) { onError(toErrorMessage(error, 'Upload sync failed')); }
    finally { isRunning = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => { isStopped = true; clearInterval(timer); };
}
