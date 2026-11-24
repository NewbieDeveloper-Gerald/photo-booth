/**
 * Guess protection for the admin PIN (F21). The booth is a public machine with a numeric
 * keypad on screen, so an unlimited number of tries is the whole risk. Five wrong tries lock
 * the PIN for a minute; the counter starts over when the lock ends or the PIN is entered
 * correctly, and a lockout never touches the stored hash.
 */
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 60_000;

export type PinLockoutState = {
  failures: number;
  /** Epoch ms when guessing may resume; null while not locked. */
  lockedUntil: number | null;
};

export function emptyLockout(): PinLockoutState {
  return { failures: 0, lockedUntil: null };
}

export function isPinLocked(state: PinLockoutState, now: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}

export function pinLockRemainingMs(state: PinLockoutState, now: number): number {
  return isPinLocked(state, now) ? Math.max(0, (state.lockedUntil as number) - now) : 0;
}

/** An expired lock is a fresh start: the next five tries are allowed again. */
export function normalizeLockout(state: PinLockoutState, now: number): PinLockoutState {
  if (state.lockedUntil === null) return state;
  return state.lockedUntil <= now ? emptyLockout() : state;
}

export function attemptsRemaining(state: PinLockoutState): number {
  return Math.max(0, MAX_PIN_ATTEMPTS - state.failures);
}

/** Counts one wrong try, locking the PIN on the fifth. */
export function registerPinFailure(state: PinLockoutState, now: number): PinLockoutState {
  const current = normalizeLockout(state, now);
  if (isPinLocked(current, now)) return current;
  const failures = current.failures + 1;
  if (failures >= MAX_PIN_ATTEMPTS) return { failures: MAX_PIN_ATTEMPTS, lockedUntil: now + PIN_LOCKOUT_MS };
  return { failures, lockedUntil: null };
}

export function registerPinSuccess(): PinLockoutState {
  return emptyLockout();
}
