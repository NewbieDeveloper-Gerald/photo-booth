import { describe, expect, it } from 'vitest';
import { canRetake, isValidRetakeLimit, retakesRemaining } from './retake-rules';

describe('retake limits', () => {
  it('supports disabled, bounded, and unlimited retakes', () => {
    expect(retakesRemaining(0, 0)).toBe(0);
    expect(canRetake(0, 0)).toBe(false);
    expect(retakesRemaining(3, 1)).toBe(2);
    expect(canRetake(3, 3)).toBe(false);
    expect(retakesRemaining(-1, 17)).toBeNull();
    expect(canRetake(-1, 17)).toBe(true);
  });

  it('accepts any nonnegative whole limit and the unlimited sentinel', () => {
    expect(isValidRetakeLimit(0)).toBe(true);
    expect(isValidRetakeLimit(10)).toBe(true);
    expect(isValidRetakeLimit(1000)).toBe(true);
    expect(isValidRetakeLimit(-1)).toBe(true);
    expect(isValidRetakeLimit(1.5)).toBe(false);
    expect(isValidRetakeLimit(-2)).toBe(false);
  });
});
