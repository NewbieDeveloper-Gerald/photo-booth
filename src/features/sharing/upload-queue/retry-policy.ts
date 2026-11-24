import { UPLOAD_INITIAL_RETRY_MS, UPLOAD_MAX_BACKOFF_EXPONENT, UPLOAD_MAX_RETRY_MS } from '../../../shared/constants/limits';

/** Exponential backoff, capped at six hours so queued uploads keep retrying overnight. */
export function nextRetryDelayMs(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('Attempt count must be a positive integer');
  return Math.min(UPLOAD_INITIAL_RETRY_MS * (2 ** Math.min(attempts - 1, UPLOAD_MAX_BACKOFF_EXPONENT)), UPLOAD_MAX_RETRY_MS);
}
