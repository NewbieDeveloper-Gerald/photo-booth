/** Shared vocabulary for the upload queue; kept separate so renderer code can read types without SQLite. */
export type UploadQueueItem = {
  id: string;
  sessionId: string;
  filePath: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped';
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
};

/**
 * What the operator's sync panel shows. Counts are deliberately split between files and
 * sessions: a guest session finishes as soon as its files are queued (it never waits for
 * an upload), so the panel reports sessions still waiting to reach the cloud plus the
 * file-level detail behind that number.
 */
export type UploadQueueSummary = {
  waitingFiles: number;
  failedFiles: number;
  uploadedFiles: number;
  /** Files the operator skipped on purpose (F21), so they stop counting as waiting. */
  skippedFiles: number;
  waitingSessions: number;
  failedSessions: number;
  lastError: string | null;
  /** When an upload last succeeded; `null` until the first successful sync. */
  lastSyncedAt: string | null;
  /** When the next backed-off retry becomes due, so the panel can say how long that is. */
  nextRetryAt: string | null;
  providerConfigured: boolean;
};

export type UploadTickResult = { processed: number; uploaded: number; failed: number };

export type UploadAdapter = { upload(item: UploadQueueItem): Promise<void> };
