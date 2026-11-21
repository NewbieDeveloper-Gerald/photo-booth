import { describe, expect, it } from 'vitest';
import { isInsideCanvas } from './layout';
import { getLayoutPreset, layoutPresets } from './layouts';

describe('operator layout presets', () => {
  it('offers all six reference arrangements with valid print bounds and matching shot counts', () => {
    expect(layoutPresets).toHaveLength(6);
    for (const layout of layoutPresets) {
      expect(layout.placements.length).toBeGreaterThanOrEqual(layout.shots);
      expect(layout.placements.every((rect) => isInsideCanvas(rect, layout.width, layout.height))).toBe(true);
      expect(new Set(layout.placements.map((rect) => rect.slot))).toEqual(new Set(Array.from({ length: layout.shots }, (_, i) => i + 1)));
    }
  });
  it('creates two copies for the strip options and supports landscape output', () => {
    expect(getLayoutPreset('double-strip-4').copies).toBe(2);
    expect(getLayoutPreset('double-strip-3').copies).toBe(2);
    expect(getLayoutPreset('grid-4-landscape')).toMatchObject({ width: 1800, height: 1200 });
  });
  it('rejects unknown layout IDs', () => { expect(() => getLayoutPreset('missing')).toThrow(/supported photo layout/); });
});
