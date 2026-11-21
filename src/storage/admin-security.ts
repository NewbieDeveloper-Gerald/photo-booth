import Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const KEY = 'adminPinHash';
const PIN_PATTERN = /^\d{6,12}$/;
function openDatabase(userDataPath: string): Database.Database {
  const db = new Database(path.join(userDataPath, 'photobooth.sqlite'));
  db.pragma('foreign_keys = ON');
  return db;
}
export function hasAdminPin(userDataPath: string): boolean {
  const db = openDatabase(userDataPath);
  try { return Boolean(db.prepare('SELECT 1 FROM settings WHERE key = ?').get(KEY)); }
  finally { db.close(); }
}
export function setAdminPin(userDataPath: string, pin: unknown): void {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new Error('PIN must be 6 to 12 digits');
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const value = `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  const db = openDatabase(userDataPath);
  try { db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(KEY, value); }
  finally { db.close(); }
}
export function verifyAdminPin(userDataPath: string, pin: unknown): boolean {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return false;
  const db = openDatabase(userDataPath);
  let stored: { value: string } | undefined;
  try { stored = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined; }
  finally { db.close(); }
  if (!stored) return false;
  const parts = stored.value.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1') return false;
  try {
    const salt = Buffer.from(parts[4]!, 'base64url');
    const expected = Buffer.from(parts[5]!, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = scryptSync(pin, salt, expected.length, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}
