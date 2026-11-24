/**
 * What an admin PIN attempt tells the screen (F21). Failures are counted per booth, and after
 * five wrong tries the PIN stops being checked for a short while, so guessing is not free.
 */
export type AdminPinAttempt =
  | { ok: true; attemptsRemaining: number }
  | {
    ok: false;
    reason: 'wrong-pin' | 'locked';
    /** How many tries are left before the lock; 0 once it is locked. */
    attemptsRemaining: number;
    /** When the lock ends (epoch ms), or null while still counting tries. */
    lockedUntil: number | null;
    /** 0 when not locked; the screen turns this into "try again in 42 s". */
    retryInMs: number;
  };

export type AdminPinLockout = {
  locked: boolean;
  lockedUntil: number | null;
  retryInMs: number;
  attemptsRemaining: number;
};
