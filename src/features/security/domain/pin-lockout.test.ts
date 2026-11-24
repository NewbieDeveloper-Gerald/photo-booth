import { describe, expect, it } from 'vitest';
import {
  MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS, attemptsRemaining, emptyLockout, isPinLocked, normalizeLockout,
  pinLockRemainingMs, registerPinFailure, registerPinSuccess,
} from './pin-lockout';

const now = Date.parse('2026-11-24T12:00:00Z');

describe('admin PIN lockout (F21)', () => {
  it('counts down from five tries and never locks before the fifth', () => {
    let state = emptyLockout();
    expect(attemptsRemaining(state)).toBe(MAX_PIN_ATTEMPTS);
    for (let attempt = 1; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      state = registerPinFailure(state, now);
      expect(isPinLocked(state, now)).toBe(false);
      expect(attemptsRemaining(state)).toBe(MAX_PIN_ATTEMPTS - attempt);
    }
    state = registerPinFailure(state, now);
    expect(isPinLocked(state, now)).toBe(true);
    expect(attemptsRemaining(state)).toBe(0);
    expect(state.lockedUntil).toBe(now + PIN_LOCKOUT_MS);
  });

  it('reports the wait and ignores further tries while locked', () => {
    let state = emptyLockout();
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) state = registerPinFailure(state, now);
    expect(pinLockRemainingMs(state, now)).toBe(PIN_LOCKOUT_MS);
    expect(pinLockRemainingMs(state, now + 20_000)).toBe(PIN_LOCKOUT_MS - 20_000);
    // A try during the lock changes nothing, so the wait cannot be shortened by guessing.
    expect(registerPinFailure(state, now + 1_000)).toEqual(state);
  });

  it('starts a fresh five tries once the lock has passed', () => {
    let state = emptyLockout();
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) state = registerPinFailure(state, now);
    const afterLock = now + PIN_LOCKOUT_MS + 1;
    expect(isPinLocked(state, afterLock)).toBe(false);
    expect(pinLockRemainingMs(state, afterLock)).toBe(0);
    const fresh = normalizeLockout(state, afterLock);
    expect(fresh).toEqual(emptyLockout());
    expect(attemptsRemaining(registerPinFailure(fresh, afterLock))).toBe(MAX_PIN_ATTEMPTS - 1);
    expect(isPinLocked(registerPinFailure(fresh, afterLock), afterLock)).toBe(false);
  });

  it('forgets the count after a correct PIN', () => {
    let state = emptyLockout();
    state = registerPinFailure(state, now);
    state = registerPinFailure(state, now);
    expect(attemptsRemaining(state)).toBe(3);
    expect(registerPinSuccess()).toEqual(emptyLockout());
    expect(registerPinFailure(registerPinSuccess(), now)).toEqual({ failures: 1, lockedUntil: null });
  });
});
