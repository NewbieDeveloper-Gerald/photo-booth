import { describe, expect, it } from 'vitest';
import template from '../../templates/default-4x6.json';
import { coverCrop, isInsideCanvas } from './layout';

describe('fixed 4x6 photo layout', () => {
  it('defines a 1200 by 1800 template with three photo slots and a QR placeholder', () => {
    expect(template).toMatchObject({ width: 1200, height: 1800 });
    expect(template.photoSlots).toHaveLength(3);
    expect(template.qrPlaceholder).toBeDefined();
    expect(template.photoSlots.every((rect) => isInsideCanvas(rect, template.width, template.height))).toBe(true);
  });
  it('center-crops a wide image to fill a portrait region', () => {
    const crop = coverCrop(1920, 1080, 1080, 420);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBeCloseTo(166.6667, 3);
    expect(crop.sw).toBe(1920);
    expect(crop.sh).toBeCloseTo(746.6667, 3);
  });
  it('rejects invalid dimensions', () => {
    expect(() => coverCrop(0, 10, 4, 4)).toThrow(RangeError);
  });
});
