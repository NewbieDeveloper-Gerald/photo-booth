import { randomBytes } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';

/**
 * The tablet screen's switch and link (F22). Both live in `settings` next to the admin PIN so a
 * restart keeps the same link, and the token is the only thing that lets a device in.
 */
const ENABLED_KEY = 'remoteGuestEnabled';
const TOKEN_KEY = 'remoteGuestToken';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isRemoteToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function readSetting(userDataPath: string, key: string): string | null {
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } finally { database.close(); }
}

function writeSetting(userDataPath: string, key: string, value: string): void {
  const database = openDatabase(userDataPath);
  try {
    database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(key, value);
  } finally { database.close(); }
}

/** Off by default: nothing listens for a tablet until the operator asks for one. */
export function readRemoteEnabled(userDataPath: string): boolean {
  return readSetting(userDataPath, ENABLED_KEY) === 'on';
}

export function setRemoteEnabled(userDataPath: string, enabled: unknown): void {
  if (typeof enabled !== 'boolean') throw new Error('Tablet screen state must be on or off');
  writeSetting(userDataPath, ENABLED_KEY, enabled ? 'on' : 'off');
}

export function readRemoteToken(userDataPath: string): string | null {
  const token = readSetting(userDataPath, TOKEN_KEY);
  return isRemoteToken(token) ? token : null;
}

/** The link is created once and kept, so the operator can bookmark it on the tablet. */
export function ensureRemoteToken(userDataPath: string): string {
  const existing = readRemoteToken(userDataPath);
  if (existing) return existing;
  const token = randomBytes(16).toString('base64url');
  writeSetting(userDataPath, TOKEN_KEY, token);
  return token;
}

/** A new link: every tablet already holding the old one is locked out at its next request. */
export function rotateRemoteToken(userDataPath: string): string {
  const token = randomBytes(16).toString('base64url');
  writeSetting(userDataPath, TOKEN_KEY, token);
  return token;
}
