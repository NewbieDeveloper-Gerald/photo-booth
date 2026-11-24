export function isValidCountdown(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= 3 && seconds <= 10;
}

export function createCountdownTicks(seconds: number): number[] {
  if (!isValidCountdown(seconds)) throw new RangeError('Countdown must be a whole number from 3 to 10 seconds');
  return Array.from({ length: seconds }, (_, index) => seconds - index);
}
