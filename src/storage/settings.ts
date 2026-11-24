import { isBoothSettingKey, type BoothSettingKey } from '../shared/constants/settings-keys';
import { MAX_CONSENT_LENGTH, MAX_DISK_WARNING_GB, MAX_SETTING_VALUE_LENGTH } from '../shared/constants/limits';
import { openDatabase } from '../features/storage/database/connection';

export type { BoothSettingKey } from '../shared/constants/settings-keys';

const COUNTDOWN_PATTERN = /^(?:[3-9]|10)$/;
const CAMERA_RESOLUTIONS = ['best', '1280x720', '1920x1080', '3840x2160'];
const DISK_WARNING_PATTERN = /^(?:\d{1,4})(?:\.\d{1,2})?$/;

function assertValidValue(key: BoothSettingKey, value: string): void {
  if (value.length > MAX_SETTING_VALUE_LENGTH && key !== 'consentText') throw new Error('Invalid setting');
  if (key === 'countdownSeconds' && !COUNTDOWN_PATTERN.test(value)) throw new Error('Countdown must be from 3 to 10 seconds');
  if (key === 'cameraResolution' && !CAMERA_RESOLUTIONS.includes(value)) throw new Error('Unsupported camera resolution');
  if (key === 'lowDiskWarningGB' && (!DISK_WARNING_PATTERN.test(value) || Number(value) > MAX_DISK_WARNING_GB)) {
    throw new Error(`Disk warning threshold must be between 0 and ${MAX_DISK_WARNING_GB} GB`);
  }
  if (key === 'consentText' && !value.trim()) throw new Error('Consent notice cannot be blank');
  if (key === 'consentText' && value.trim().length > MAX_CONSENT_LENGTH) throw new Error(`Consent notice must be ${MAX_CONSENT_LENGTH} characters or fewer`);
  if (key === 'downloadBaseUrl' && value !== '') assertSiteOrigin(value);
}

/** The QR links are built as `<origin>/d/<token>`, so only a bare HTTPS origin is accepted. */
function assertSiteOrigin(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Download URL must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Download URL must use HTTPS and contain no credentials, query, or fragment');
  }
  if (value !== url.origin) throw new Error('Enter only the HTTPS site origin, for example https://photos.example.com');
}

export function readBoothSetting(userDataPath: string, key: unknown): string | null {
  if (!isBoothSettingKey(key)) throw new Error('Unsupported setting');
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    database.close();
  }
}

export function writeBoothSetting(userDataPath: string, key: unknown, value: unknown): void {
  if (!isBoothSettingKey(key) || typeof value !== 'string') throw new Error('Invalid setting');
  assertValidValue(key, value);
  const database = openDatabase(userDataPath);
  try {
    database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(key, value);
  } finally {
    database.close();
  }
}
