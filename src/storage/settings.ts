import Database from 'better-sqlite3';
import path from 'node:path';

export type BoothSettingKey = 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB' | 'selectedPrinterName';

const allowedKeys = new Set<BoothSettingKey>(['selectedCameraId', 'countdownSeconds', 'cameraResolution', 'lowDiskWarningGB', 'selectedPrinterName']);

function isAllowedKey(key: unknown): key is BoothSettingKey {
  return typeof key === 'string' && allowedKeys.has(key as BoothSettingKey);
}

function openDatabase(userDataPath: string): Database.Database {
  const database = new Database(path.join(userDataPath, 'photobooth.sqlite'));
  database.pragma('foreign_keys = ON');
  return database;
}

export function readBoothSetting(userDataPath: string, key: unknown): string | null {
  if (!isAllowedKey(key)) throw new Error('Unsupported setting');
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    database.close();
  }
}

export function writeBoothSetting(userDataPath: string, key: unknown, value: unknown): void {
  if (!isAllowedKey(key) || typeof value !== 'string' || value.length > 256) {
    throw new Error('Invalid setting');
  }
  if (key === 'countdownSeconds' && !/^(?:[3-9]|10)$/.test(value)) {
    throw new Error('Countdown must be from 3 to 10 seconds');
  }
  if (key === 'cameraResolution' && !['best', '1280x720', '1920x1080', '3840x2160'].includes(value)) {
    throw new Error('Unsupported camera resolution');
  }
  if (key === 'lowDiskWarningGB' && (!/^(?:\d{1,4})(?:\.\d{1,2})?$/.test(value) || Number(value) > 1000)) {
    throw new Error('Disk warning threshold must be between 0 and 1000 GB');
  }
  const database = openDatabase(userDataPath);
  try {
    database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(key, value);
  } finally {
    database.close();
  }
}
