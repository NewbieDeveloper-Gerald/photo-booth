import { RETENTION_SWEEP_INTERVAL_MS } from '../../shared/constants/limits';
import { startIntervalJob } from '../../shared/scheduling/interval-job';
import { purgeExpiredSessions, type PurgeResult } from './data/retention-repository';

type RetentionSchedulerOptions = {
  userDataPath: string;
  intervalMs?: number;
  onError?: (message: string) => void;
  /** The sweep, injected so tests can drive runs without a database. */
  runSweep?: (userDataPath: string) => Promise<PurgeResult>;
};

/**
 * The daily cleanup job: at startup (catching up on days the booth was closed) and then
 * every `RETENTION_SWEEP_INTERVAL_MS`. Expired sessions are removed from disk and from the
 * database; a cloud provider hooks in through `purgeExpiredSessions` options.
 */
export function startRetentionScheduler({
  userDataPath,
  intervalMs = RETENTION_SWEEP_INTERVAL_MS,
  onError,
  runSweep = (path: string) => purgeExpiredSessions(path),
}: RetentionSchedulerOptions): () => void {
  return startIntervalJob({ run: async () => { await runSweep(userDataPath); }, intervalMs, onError });
}
