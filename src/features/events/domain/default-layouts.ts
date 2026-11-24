/**
 * Default template per shot count. 2–4 photos keep the Phase 1 branded strips; 1 and
 * 5–6 use the 5 × 7 grid templates, which exist for every supported shot count (F11).
 * Shared with the renderer so the event form shows the same default the booth will use.
 */
const DEFAULT_TEMPLATE_BY_SHOTS: Record<number, string> = {
  1: '5x7-1x1', 2: 'double-strip-2', 3: 'double-strip-3', 4: 'double-strip-4', 5: '5x7-5x1', 6: '5x7-6x1',
};

export function isSupportedShotCount(shots: number): boolean {
  return Object.hasOwn(DEFAULT_TEMPLATE_BY_SHOTS, shots);
}

/** The layout an event starts with; guests may still be offered others. */
export function defaultLayoutIdForShots(shots: number): string {
  const layoutId = DEFAULT_TEMPLATE_BY_SHOTS[shots];
  if (!layoutId) throw new Error('Choose between 1 and 6 photos per session');
  return layoutId;
}
