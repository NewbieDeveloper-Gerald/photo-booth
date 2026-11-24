import React from 'react';
import type { RetentionStatus } from '../../features/retention';

/**
 * Tells the operator what the daily cleanup job has done and whether anything is past its
 * sharing period, so "photos are deleted automatically" is visible rather than assumed.
 */
export function RetentionNote({ status }: { status: RetentionStatus }): React.JSX.Element {
  const lastRun = status.lastSweepAt ? new Date(status.lastSweepAt).toLocaleString() : 'not run yet';
  const waiting = status.expiredSessions;
  return (
    <p className="retention-note" aria-label="Expiry cleanup status">
      Expired links are removed daily · last cleanup: {lastRun} · {waiting === 0 ? 'nothing is past its expiry' : `${waiting} ${waiting === 1 ? 'session is' : 'sessions are'} past expiry and will be deleted on the next cleanup`}
    </p>
  );
}
