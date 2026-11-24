/** Renderer-safe surface; the download server and queue storage live in ./node.ts. */
export { renderGuestPage, renderUnavailablePage, type DownloadFile, type SessionDownload, type UnavailablePage } from './guest-page-html';
export { nextRetryDelayMs } from './upload-queue/retry-policy';
export type { UploadQueueItem, UploadQueueSummary } from './upload-queue/types';
// Link delivery (F28): the composable parts are renderer-safe; the sender and the service that
// talks to the database live in ./node.ts.
export { LINK_CHANNEL_LABELS, type LinkChannel, type LinkDeliveryRequest, type LinkDeliveryResult, type LinkSender, type SendLinkOutcome } from './link-delivery/types';
export { MAX_EMAIL_LENGTH, isLinkChannel, maskTarget, normaliseEmail, normalisePhone, normaliseTarget } from './link-delivery/addresses';
export { MAX_SMS_CHARS, composeLinkMessage, formatExpiry } from './link-delivery/message';
