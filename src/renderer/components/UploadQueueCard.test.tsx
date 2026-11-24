// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UploadQueueSummary } from '../../features/sharing';
import { UploadQueueCard } from './UploadQueueCard';

function summary(overrides: Partial<UploadQueueSummary> = {}): UploadQueueSummary {
  return {
    waitingFiles: 0, failedFiles: 0, uploadedFiles: 0, waitingSessions: 0, failedSessions: 0,
    lastError: null, lastSyncedAt: null, nextRetryAt: null, providerConfigured: false,
    ...overrides,
  };
}

describe('UploadQueueCard (F14)', () => {
  it('says how many sessions are still waiting to sync', () => {
    render(<UploadQueueCard summary={summary({ waitingSessions: 3, waitingFiles: 5 })} />);
    expect(screen.getByText('3 sessions waiting · 5 files')).toBeDefined();
  });

  it('says that everything is synced when nothing is waiting', () => {
    render(<UploadQueueCard summary={summary({ uploadedFiles: 4, lastSyncedAt: new Date().toISOString() })} />);
    expect(screen.getByText('All queued files synced')).toBeDefined();
    expect(screen.getByText(/Last successful sync: just now/)).toBeDefined();
  });

  it('admits that nothing has ever synced', () => {
    render(<UploadQueueCard summary={summary()} />);
    expect(screen.getByText(/Last successful sync: never/)).toBeDefined();
  });

  it('shows the last error and when the next retry is due', () => {
    render(<UploadQueueCard summary={summary({ waitingSessions: 1, waitingFiles: 1, lastError: 'Wi-Fi is off', nextRetryAt: new Date(Date.now() + 4 * 60_000).toISOString() })} />);
    expect(screen.getByText('Last error: Wi-Fi is off')).toBeDefined();
    expect(screen.getByText('Next retry: in 4 min')).toBeDefined();
  });

  it('never claims uploads happen without a provider', () => {
    render(<UploadQueueCard summary={summary({ waitingSessions: 1, waitingFiles: 1 })} />);
    expect(screen.getByText(/nothing is sent online/)).toBeDefined();
    expect(screen.getByText(/MOCK PROVIDER/)).toBeDefined();
  });

  it('adds how long ago the last sync was for older successes', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    render(<UploadQueueCard summary={summary({ uploadedFiles: 2, lastSyncedAt: twoHoursAgo })} />);
    expect(screen.getByText(/Last successful sync: 2 hours ago/)).toBeDefined();
  });
});
