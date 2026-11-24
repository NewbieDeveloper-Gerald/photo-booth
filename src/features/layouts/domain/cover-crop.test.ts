import { describe, expect, it } from 'vitest';
import { coverCrop, isInsideCanvas } from './cover-crop';

describe('cover crop and canvas bounds', () => {
  it('center-crops a wide image to fill a portrait region', () => {
    const crop = coverCrop(1920, 1080, 1080, 420);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBeCloseTo(166.6667, 3);
    expect(crop.sw).toBe(1920);
    expect(crop.sh).toBeCloseTo(746.6667, 3);
  });
  it('center-crops a tall image to fill a landscape region', () => {
    const crop = coverCrop(1081, 1920, 600, 400);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBeCloseTo(599.6667, 3);
    expect(crop.sh).toBeCloseTo(720.6667, 3);
  });
  it('keeps every catalog placement inside its canvas', () => {
    const canvas = { width: 1200, height: 1800 };
    expect(isInsideCanvas({ x: 10, y: 10, width: 100, height: 100 }, canvas.width, canvas.height)).toBe(true);
    expect(isInsideCanvas({ x: 1150, y: 10, width: 100, height: 100 }, canvas.width, canvas.height)).toBe(false);
  });
  it('rejects invalid dimensions', () => {
    expect(() => coverCrop(0, 10, 4, 4)).toThrow(RangeError);
  });
});
