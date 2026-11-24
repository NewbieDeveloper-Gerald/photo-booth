/** Numeric limits and physical constants shared by the main process and the renderer. */

// Guest download service
export const DOWNLOAD_SERVER_PORT = 47_625;
export const DOWNLOAD_SERVER_HOST = '127.0.0.1';
export const DOWNLOAD_RATE_WINDOW_MS = 60_000;
export const DOWNLOAD_MAX_REQUESTS_PER_WINDOW = 180;

// Image pipeline
export const ORIGINAL_JPEG_QUALITY = 0.98;
export const GUEST_COPY_MAX_EDGE_PX = 2048;
export const GUEST_COPY_JPEG_QUALITY = 0.8;
export const MAX_PHOTO_BYTES = 100 * 1024 * 1024;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// Printing
export const PRINT_DPI = 300;
export const MICRONS_PER_INCH = 25_400;

// Session flow
export const SESSION_IDLE_TIMEOUT_MS = 90_000;
export const CAPTURE_REVIEW_PAUSE_MS = 1_300;

// Settings and event validation
export const BYTES_PER_GIGABYTE = 1024 ** 3;
export const MAX_DISK_WARNING_GB = 1000;
export const MAX_SETTING_VALUE_LENGTH = 256;
export const MAX_CONSENT_LENGTH = 1200;
export const MAX_EVENT_NAME_LENGTH = 80;
export const MAX_EVENT_TEXT_LENGTH = 160;
export const MAX_OFFERED_LAYOUTS = 12;

// Upload queue retry policy
export const UPLOAD_INITIAL_RETRY_MS = 30_000;
export const UPLOAD_MAX_RETRY_MS = 6 * 60 * 60 * 1000;
export const UPLOAD_MAX_BACKOFF_EXPONENT = 10;
export const MAX_UPLOAD_ERROR_LENGTH = 500;
export const UPLOAD_SYNC_INTERVAL_MS = 60_000;
export const UPLOAD_STATUS_POLL_MS = 15_000;
