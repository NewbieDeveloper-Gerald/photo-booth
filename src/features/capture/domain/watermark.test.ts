import { describe, expect, it, vi } from 'vitest';
import { drawWatermark, isWatermarkPosition, watermarkPlacement } from './watermark';

const logo = { logoWidth: 200, logoHeight: 100 };
const settings = { position: 'bottom-right' as const, scalePercent: 20, opacity: 0.6 };

describe('watermark placement (F17)', () => {
  it('sizes the mark relative to the photo width and keeps the logo ratio', () => {
    const placement = watermarkPlacement({ photoWidth: 2000, photoHeight: 1500, ...logo, settings });
    expect(placement.width).toBe(400);
    expect(placement.height).toBe(200);
  });

  it('sits in the chosen corner with a small margin', () => {
    // 4% of the shorter side (1500) = 60 px of margin.
    expect(watermarkPlacement({ photoWidth: 2000, photoHeight: 1500, ...logo, settings })).toEqual({ x: 1540, y: 1240, width: 400, height: 200 });
    expect(watermarkPlacement({ photoWidth: 2000, photoHeight: 1500, ...logo, settings: { ...settings, position: 'top-left' } })).toEqual({ x: 60, y: 60, width: 400, height: 200 });
    expect(watermarkPlacement({ photoWidth: 2000, photoHeight: 1500, ...logo, settings: { ...settings, position: 'top-right' } })).toEqual({ x: 1540, y: 60, width: 400, height: 200 });
    expect(watermarkPlacement({ photoWidth: 2000, photoHeight: 1500, ...logo, settings: { ...settings, position: 'bottom-left' } })).toEqual({ x: 60, y: 1240, width: 400, height: 200 });
  });

  it('centres the mark when asked', () => {
    expect(watermarkPlacement({ photoWidth: 2000, photoHeight: 1500, ...logo, settings: { ...settings, position: 'center' } })).toEqual({ x: 800, y: 650, width: 400, height: 200 });
  });

  it('keeps a large mark inside the photo instead of overflowing it', () => {
    const placement = watermarkPlacement({ photoWidth: 300, photoHeight: 200, logoWidth: 100, logoHeight: 100, settings: { position: 'bottom-right', scalePercent: 50, opacity: 1 } });
    expect(placement.x + placement.width).toBeLessThanOrEqual(300);
    expect(placement.y + placement.height).toBeLessThanOrEqual(200);
    // A square logo on a wide photo cannot keep its margin once it is taller than the gap.
    expect(placement).toEqual({ x: 142, y: 42, width: 150, height: 150 });
  });

  it('shrinks a tall mark to fit the photo height without squashing it', () => {
    const placement = watermarkPlacement({ photoWidth: 100, photoHeight: 30, logoWidth: 10, logoHeight: 40, settings: { position: 'bottom-right', scalePercent: 50, opacity: 1 } });
    expect(placement.height).toBeLessThanOrEqual(30);
    expect(placement.width / placement.height).toBeCloseTo(0.25, 1);
    expect(placement.x + placement.width).toBeLessThanOrEqual(100);
  });

  it('rejects impossible dimensions', () => {
    expect(() => watermarkPlacement({ photoWidth: 0, photoHeight: 100, ...logo, settings })).toThrow(RangeError);
    expect(() => watermarkPlacement({ photoWidth: 100, photoHeight: 100, logoWidth: 0, logoHeight: 10, settings })).toThrow(RangeError);
  });

  it('accepts only the five supported positions', () => {
    expect(isWatermarkPosition('top-left')).toBe(true);
    expect(isWatermarkPosition('center')).toBe(true);
    expect(isWatermarkPosition('middle')).toBe(false);
    expect(isWatermarkPosition(42)).toBe(false);
  });
});

describe('watermark drawing (F17)', () => {
  it('draws the logo once at the placement with the event opacity, then restores', () => {
    const context = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 };
    const placement = { x: 10, y: 20, width: 30, height: 40 };
    drawWatermark(context, 'logo-image' as unknown as CanvasImageSource, placement, 0.35);
    expect(context.globalAlpha).toBe(0.35);
    expect(context.drawImage).toHaveBeenCalledWith('logo-image', 10, 20, 30, 40);
    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
  });

  it('clamps opacity into a visible range', () => {
    const faint = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 };
    drawWatermark(faint, null as unknown as CanvasImageSource, { x: 0, y: 0, width: 1, height: 1 }, 0);
    expect(faint.globalAlpha).toBe(0.1);
    const solid = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 };
    drawWatermark(solid, null as unknown as CanvasImageSource, { x: 0, y: 0, width: 1, height: 1 }, 5);
    expect(solid.globalAlpha).toBe(1);
  });
});
