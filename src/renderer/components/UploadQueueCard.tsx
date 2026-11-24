import React from 'react';
import type { UploadQueueSummary } from '../../features/sharing';

type UploadQueueCardProps = { summary: UploadQueueSummary };

/** Keeps the wording short: the panel sits on the guest-facing start screen. */
function relativeTime(isoTimestamp: string, now: number): string {
  const elapsedMs = Math.max(0, now - Date.parse(isoTimestamp));
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** "in 4 min" for a retry that is still waiting for its backoff. */
function untilTime(isoTimestamp: string, now: number): string {
  const remainingMs = Date.parse(isoTimestamp) - now;
  if (remainingMs <= 0) return 'now';
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

const NO_ERROR = 'none recorded';

/**
 * Honest sync status for the queue: how many guest sessions are still waiting, why the
 * last attempt failed, when the next retry is due and when an upload last succeeded.
 * No cloud provider is configured yet, so the panel names the mock instead of implying
 * that photos reach the internet.
 */
export function UploadQueueCard({ summary }: UploadQueueCardProps): React.JSX.Element {
  const now = Date.now();
  const isWaiting = summary.waitingSessions > 0;
  return (
    <section className="recovery-card upload-queue-card" aria-label="Upload queue status">
      <div>
        <p className="eyebrow">SYNC STATUS · MOCK PROVIDER</p>
        <strong>{isWaiting ? `${summary.waitingSessions} ${summary.waitingSessions === 1 ? 'session' : 'sessions'} waiting · ${summary.waitingFiles} ${summary.waitingFiles === 1 ? 'file' : 'files'}` : 'All queued files synced'}</strong>
        <span>Last successful sync: {summary.lastSyncedAt ? relativeTime(summary.lastSyncedAt, now) : 'never'} · Synced files: {summary.uploadedFiles}{summary.failedFiles > 0 ? ` · ${summary.failedFiles} failed in ${summary.failedSessions} ${summary.failedSessions === 1 ? 'session' : 'sessions'}` : ''}{summary.skippedFiles > 0 ? ` · ${summary.skippedFiles} skipped by the operator` : ''}</span>
        {summary.lastError && <span className="queue-error">Last error: {summary.lastError}</span>}
        {summary.nextRetryAt && <span>Next retry: {untilTime(summary.nextRetryAt, now)}</span>}
        <span className="queue-note">Sessions never wait for a sync: files are queued the moment the layout is saved and retried in the background with growing delays, even after a restart. No cloud provider is configured yet — the mock provider only checks that each queued file is still on this booth, so nothing is sent online.</span>
      </div>
      <span className="queue-failed" title={`Last error: ${summary.lastError ?? NO_ERROR}`}>{summary.failedFiles} failed</span>
    </section>
  );
}
