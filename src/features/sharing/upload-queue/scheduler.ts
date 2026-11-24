import { UPLOAD_SYNC_INTERVAL_MS } from '../../../shared/constants/limits';
import { startIntervalJob } from '../../../shared/scheduling/interval-job';
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
 * closed resume immediately) and then on a timer.
 */
export function startUploadScheduler({
  userDataPath,
  adapter,
  intervalMs = UPLOAD_SYNC_INTERVAL_MS,
  onError,
  runBatch = processDueUploads,
}: UploadSchedulerOptions): () => void {
  return startIntervalJob({ run: async () => { await runBatch(userDataPath, adapter); }, intervalMs, onError });
}
