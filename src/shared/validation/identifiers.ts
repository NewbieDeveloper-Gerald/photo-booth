/**
 * Identifier shapes accepted from IPC payloads and URL paths.
 * The patterns intentionally match what earlier releases accepted, so stored data keeps validating.
 */
const RECORD_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const EVENT_ID_PATTERN = /^[a-z0-9-]{1,64}$/i;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID_PATTERN.test(value);
}

/** Session, slot, photo and output ids are all UUIDs. */
export const isRecordId = isSessionId;

export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && EVENT_ID_PATTERN.test(value);
}

export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value);
}
