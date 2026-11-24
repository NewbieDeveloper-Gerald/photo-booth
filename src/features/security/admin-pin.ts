import { openDatabase } from '../storage/database/connection';
import { hashSecret, verifySecret } from '../../shared/crypto/secret-hash';
import type { AdminPinAttempt, AdminPinLockout } from '../../shared/types/admin-pin';
import {
  attemptsRemaining, emptyLockout, isPinLocked, normalizeLockout, pinLockRemainingMs, registerPinFailure,
  registerPinSuccess, type PinLockoutState,
} from './domain/pin-lockout';

const KEY = 'adminPinHash';
const FAILURES_KEY = 'adminPinFailures';
const LOCKED_UNTIL_KEY = 'adminPinLockedUntil';
const PIN_PATTERN = /^\d{6,12}$/;

function readLockout(userDataPath: string): PinLockoutState {
  const db = openDatabase(userDataPath);
  try {
    const rows = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').all(FAILURES_KEY, LOCKED_UNTIL_KEY) as Array<{ key: string; value: string }>;
    const failures = Number(rows.find((row) => row.key === FAILURES_KEY)?.value ?? '0');
    const lockedUntil = Number(rows.find((row) => row.key === LOCKED_UNTIL_KEY)?.value ?? '');
    return {
      failures: Number.isInteger(failures) && failures > 0 ? failures : 0,
      lockedUntil: Number.isFinite(lockedUntil) && lockedUntil > 0 ? lockedUntil : null,
    };
  } finally { db.close(); }
}

function writeLockout(userDataPath: string, state: PinLockoutState): void {
  const db = openDatabase(userDataPath);
  try {
    const upsert = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
    db.transaction(() => {
      upsert.run(FAILURES_KEY, String(state.failures));
      upsert.run(LOCKED_UNTIL_KEY, state.lockedUntil === null ? '' : String(state.lockedUntil));
    })();
  } finally { db.close(); }
}

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
  // A freshly chosen PIN starts with a clean slate.
  writeLockout(userDataPath, emptyLockout());
}

/** What the guest-facing prompts need to say right now: locked, for how long, tries left. */
export function getAdminPinLockout(userDataPath: string, now = Date.now()): AdminPinLockout {
  const state = normalizeLockout(readLockout(userDataPath), now);
  return {
    locked: isPinLocked(state, now),
    lockedUntil: isPinLocked(state, now) ? state.lockedUntil : null,
    retryInMs: pinLockRemainingMs(state, now),
    attemptsRemaining: attemptsRemaining(state),
  };
}

/**
 * Checks the PIN once (F21). Five wrong tries lock the check for a minute, and while locked
 * even the correct PIN is refused so the wait cannot be probed away. A malformed PIN counts as
 * a wrong try but never reaches scrypt, so a keypad mashing guest cannot load the booth.
 */
export function attemptAdminPin(userDataPath: string, pin: unknown, now = Date.now()): AdminPinAttempt {
  const state = normalizeLockout(readLockout(userDataPath), now);
  if (isPinLocked(state, now)) {
    return { ok: false, reason: 'locked', attemptsRemaining: 0, lockedUntil: state.lockedUntil, retryInMs: pinLockRemainingMs(state, now) };
  }
  const wellFormed = typeof pin === 'string' && PIN_PATTERN.test(pin);
  let stored: { value: string } | undefined;
  if (wellFormed) {
    const db = openDatabase(userDataPath);
    try { stored = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined; }
    finally { db.close(); }
  }
  if (wellFormed && stored && verifySecret(pin as string, stored.value)) {
    writeLockout(userDataPath, registerPinSuccess());
    return { ok: true, attemptsRemaining: attemptsRemaining(emptyLockout()) };
  }
  const next = registerPinFailure(state, now);
  writeLockout(userDataPath, next);
  const locked = isPinLocked(next, now);
  return {
    ok: false,
    reason: locked ? 'locked' : 'wrong-pin',
    attemptsRemaining: attemptsRemaining(next),
    lockedUntil: locked ? next.lockedUntil : null,
    retryInMs: pinLockRemainingMs(next, now),
  };
}

/** Kept for callers that only need a yes/no; a locked PIN answers "no" (F9 behaviour). */
export function verifyAdminPin(userDataPath: string, pin: unknown, now = Date.now()): boolean {
  return attemptAdminPin(userDataPath, pin, now).ok;
}
