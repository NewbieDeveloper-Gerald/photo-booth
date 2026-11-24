/** Renderer-safe surface; the download server and queue storage live in ./node.ts. */
export { renderGuestPage, type DownloadFile, type SessionDownload } from './guest-page-html';
export { nextRetryDelayMs } from './upload-queue/retry-policy';
export type { UploadQueueItem, UploadQueueSummary } from './upload-queue/types';
