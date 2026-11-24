export type RetakeLimit = number; // -1 means unlimited; 0 means disabled.

export function isValidRetakeLimit(limit: number): boolean {
  return Number.isSafeInteger(limit) && (limit === -1 || limit >= 0);
}

export function retakesRemaining(limit: RetakeLimit, used: number): number | null {
  if (!isValidRetakeLimit(limit) || !Number.isInteger(used) || used < 0) throw new RangeError('Invalid retake count or limit');
  return limit === -1 ? null : Math.max(0, limit - used);
}

export function canRetake(limit: RetakeLimit, used: number): boolean {
  const remaining = retakesRemaining(limit, used);
  return remaining === null || remaining > 0;
}
