const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/** Falls back to a known-good colour so a bad stored value cannot break the guest page or a layout. */
export function hexColorOrDefault(value: string | null | undefined, fallback: string): string {
  return isHexColor(value) ? value : fallback;
}
