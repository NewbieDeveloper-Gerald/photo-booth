import { describe, expect, it } from 'vitest';
import { nextRetryDelayMs } from './retry-policy';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('upload retry policy', () => {
  it('starts at 30 seconds and doubles each attempt', () => {
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(MINUTE);
    expect(nextRetryDelayMs(3)).toBe(2 * MINUTE);
  });

  it('caps the delay at six hours', () => {
    expect(nextRetryDelayMs(40)).toBe(6 * HOUR);
  });

  it('rejects nonsensical attempt counts', () => {
    expect(() => nextRetryDelayMs(0)).toThrow(RangeError);
    expect(() => nextRetryDelayMs(1.5)).toThrow(RangeError);
  });
});
