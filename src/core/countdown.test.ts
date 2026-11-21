import { describe, expect, it } from 'vitest';
import { createCountdownTicks, isValidCountdown } from './countdown';

describe('countdown helpers', () => {
  it('accepts whole countdown values from 3 to 10 seconds', () => {
    expect(isValidCountdown(3)).toBe(true);
    expect(isValidCountdown(10)).toBe(true);
    expect(isValidCountdown(2)).toBe(false);
    expect(isValidCountdown(11)).toBe(false);
    expect(isValidCountdown(3.5)).toBe(false);
  });

  it('creates descending countdown ticks', () => {
    expect(createCountdownTicks(3)).toEqual([3, 2, 1]);
  });

  it('rejects values outside the supported range', () => {
    expect(() => createCountdownTicks(2)).toThrow(RangeError);
  });
});
