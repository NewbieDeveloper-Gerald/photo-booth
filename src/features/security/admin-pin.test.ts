import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../storage/database/initialize';
import { MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS } from './domain/pin-lockout';
import { attemptAdminPin, getAdminPinLockout, hasAdminPin, setAdminPin, verifyAdminPin } from './admin-pin';

const dirs: string[] = [];
function setup(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-admin-pin-'));
  dirs.push(dir);
  initializeStorage(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('admin PIN security', () => {
  it('stores a salted scrypt hash, never the raw PIN, and verifies it', () => {
    const dir = setup();
    expect(hasAdminPin(dir)).toBe(false);
    setAdminPin(dir, '381927');
    expect(hasAdminPin(dir)).toBe(true);
    expect(verifyAdminPin(dir, '381927')).toBe(true);
    expect(verifyAdminPin(dir, '381928')).toBe(false);
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    const row = db.prepare("SELECT value FROM settings WHERE key = 'adminPinHash'").get() as { value: string };
    db.close();
    expect(row.value).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(row.value).not.toContain('381927');
  });

  it('rejects weak formats and never verifies when no PIN has been set', () => {
    const dir = setup();
    expect(() => setAdminPin(dir, '1234')).toThrow(/6 to 12 digits/);
    expect(() => setAdminPin(dir, '12ab56')).toThrow(/6 to 12 digits/);
    expect(verifyAdminPin(dir, '123456')).toBe(false);
  });
});

describe('admin PIN lockout (F21)', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');

  it('refuses the PIN for a minute after five wrong tries, even when it is right', () => {
    const dir = setup();
    setAdminPin(dir, '381927');
    let attempt = attemptAdminPin(dir, '111111', now);
    expect(attempt).toMatchObject({ ok: false, reason: 'wrong-pin', attemptsRemaining: MAX_PIN_ATTEMPTS - 1, lockedUntil: null, retryInMs: 0 });
    for (let tries = 1; tries < MAX_PIN_ATTEMPTS; tries += 1) attempt = attemptAdminPin(dir, '111111', now);
    expect(attempt).toMatchObject({ ok: false, reason: 'locked', attemptsRemaining: 0, lockedUntil: now + PIN_LOCKOUT_MS, retryInMs: PIN_LOCKOUT_MS });
    // The correct PIN is refused while locked: the wait cannot be probed away.
    expect(attemptAdminPin(dir, '381927', now + 1_000)).toMatchObject({ ok: false, reason: 'locked', retryInMs: PIN_LOCKOUT_MS - 1_000 });
    expect(verifyAdminPin(dir, '381927', now + 1_000)).toBe(false);
    expect(getAdminPinLockout(dir, now + 1_000)).toMatchObject({ locked: true, retryInMs: PIN_LOCKOUT_MS - 1_000, attemptsRemaining: 0 });
  });

  it('accepts the PIN again after the wait and clears the counter', () => {
    const dir = setup();
    setAdminPin(dir, '381927');
    for (let tries = 0; tries < MAX_PIN_ATTEMPTS; tries += 1) attemptAdminPin(dir, '111111', now);
    const afterLock = now + PIN_LOCKOUT_MS + 1;
    expect(getAdminPinLockout(dir, afterLock)).toMatchObject({ locked: false, retryInMs: 0, attemptsRemaining: MAX_PIN_ATTEMPTS });
    expect(attemptAdminPin(dir, '381927', afterLock)).toMatchObject({ ok: true, attemptsRemaining: MAX_PIN_ATTEMPTS });
    expect(attemptAdminPin(dir, '111111', afterLock)).toMatchObject({ ok: false, attemptsRemaining: MAX_PIN_ATTEMPTS - 1 });
  });

  it('counts a malformed PIN as a wrong try without hashing it', () => {
    const dir = setup();
    setAdminPin(dir, '381927');
    expect(attemptAdminPin(dir, '12', now)).toMatchObject({ ok: false, reason: 'wrong-pin', attemptsRemaining: MAX_PIN_ATTEMPTS - 1 });
    expect(attemptAdminPin(dir, null, now)).toMatchObject({ ok: false, attemptsRemaining: MAX_PIN_ATTEMPTS - 2 });
  });

  it('gives a fresh PIN a clean slate', () => {
    const dir = setup();
    setAdminPin(dir, '381927');
    for (let tries = 0; tries < MAX_PIN_ATTEMPTS; tries += 1) attemptAdminPin(dir, '111111', now);
    expect(getAdminPinLockout(dir, now).locked).toBe(true);
    setAdminPin(dir, '445566');
    expect(getAdminPinLockout(dir, now)).toMatchObject({ locked: false, attemptsRemaining: MAX_PIN_ATTEMPTS });
    expect(attemptAdminPin(dir, '445566', now).ok).toBe(true);
  });
});
