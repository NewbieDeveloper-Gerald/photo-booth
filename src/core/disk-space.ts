import { BYTES_PER_GIGABYTE } from '../shared/constants/limits';

export function isBelowDiskWarningThreshold(freeBytes: number, thresholdGB: number): boolean {
  if (!Number.isFinite(freeBytes) || freeBytes < 0 || !Number.isFinite(thresholdGB) || thresholdGB < 0) {
    throw new Error('Invalid disk-space values');
  }
  return freeBytes < thresholdGB * BYTES_PER_GIGABYTE;
}
