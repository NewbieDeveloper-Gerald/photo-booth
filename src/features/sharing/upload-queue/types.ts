/** Shared vocabulary for the upload queue; kept separate so renderer code can read types without SQLite. */
export type UploadQueueItem = {
  id: string;
  sessionId: string;
  filePath: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type UploadQueueSummary = { pending: number; uploading: number; uploaded: number; failed: number; lastError: string | null; providerConfigured: false };

export type UploadAdapter = { upload(item: UploadQueueItem): Promise<void> };
