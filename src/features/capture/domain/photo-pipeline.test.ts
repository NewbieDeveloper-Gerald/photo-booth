import { describe, expect, it } from 'vitest';
import { fitDimensions } from './photo-pipeline';

describe('fitDimensions', () => {
  it('scales landscape images to a 2048 pixel long edge without upscaling', () => {
    expect(fitDimensions(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(fitDimensions(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it('scales portrait images and keeps dimensions at least one pixel', () => {
    expect(fitDimensions(3000, 4000)).toEqual({ width: 1536, height: 2048 });
    expect(fitDimensions(1, 10000)).toEqual({ width: 1, height: 2048 });
  });

  it('rejects invalid dimensions', () => {
    expect(() => fitDimensions(0, 100)).toThrow(RangeError);
    expect(() => fitDimensions(100, 100, 0)).toThrow(RangeError);
  });
});
