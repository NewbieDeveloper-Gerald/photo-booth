import { openDatabase } from '../storage/database/connection';
import { hashSecret, verifySecret } from '../../shared/crypto/secret-hash';

const KEY = 'adminPinHash';
const PIN_PATTERN = /^\d{6,12}$/;

export function hasAdminPin(userDataPath: string): boolean {
  const db = openDatabase(userDataPath);
  try { return Boolean(db.prepare('SELECT 1 FROM settings WHERE key = ?').get(KEY)); }
  finally { db.close(); }
}

export function setAdminPin(userDataPath: string, pin: unknown): void {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new Error('PIN must be 6 to 12 digits');
  const db = openDatabase(userDataPath);
  try {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(KEY, hashSecret(pin));
  } finally { db.close(); }
}

export function verifyAdminPin(userDataPath: string, pin: unknown): boolean {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return false;
  const db = openDatabase(userDataPath);
  let stored: { value: string } | undefined;
  try { stored = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined; }
  finally { db.close(); }
  return stored ? verifySecret(pin, stored.value) : false;
}
