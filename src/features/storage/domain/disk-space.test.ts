import { describe, expect, it } from 'vitest';
import { isBelowDiskWarningThreshold } from './disk-space';

describe('disk space warning threshold', () => {
  it('warns below the configured threshold and not at or above it', () => {
    expect(isBelowDiskWarningThreshold(1.5 * 1024 ** 3, 2)).toBe(true);
    expect(isBelowDiskWarningThreshold(2 * 1024 ** 3, 2)).toBe(false);
    expect(isBelowDiskWarningThreshold(5 * 1024 ** 3, 2)).toBe(false);
  });
  it('does not warn at a zero threshold', () => {
    expect(isBelowDiskWarningThreshold(0, 0)).toBe(false);
  });
  it('rejects invalid inputs', () => {
    expect(() => isBelowDiskWarningThreshold(-1, 2)).toThrow('Invalid disk-space values');
  });
});
