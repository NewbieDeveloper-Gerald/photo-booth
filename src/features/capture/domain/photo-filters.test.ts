import { describe, expect, it, vi } from 'vitest';
import {
  PHOTO_FILTERS, cssPhotoFilter, drawFiltered, filterPasses, isPhotoFilterId, photoFilterLabel,
} from './photo-filters';

/** jsdom has no canvas, so the drawing is checked through a recording 2D context. */
function context(): { ctx: CanvasRenderingContext2D; draws: Array<{ filter: string; alpha: number }>; clipped: number[][] } {
  const draws: Array<{ filter: string; alpha: number }> = [];
  const clipped: number[][] = [];
  const state = { filter: 'none', globalAlpha: 1 };
  const ctx = {
    get filter() { return state.filter; },
    set filter(value: string) { state.filter = value; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(value: number) { state.globalAlpha = value; },
    save: vi.fn(),
    restore: vi.fn(() => { state.filter = 'none'; state.globalAlpha = 1; }),
    beginPath: vi.fn(),
    rect: (...args: number[]) => { clipped.push(args); },
    clip: vi.fn(),
    drawImage: vi.fn(() => { draws.push({ filter: state.filter, alpha: state.globalAlpha }); }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws, clipped };
}

describe('photo filters (F20)', () => {
  it('offers the three looks plus the original, in guest order', () => {
    expect(PHOTO_FILTERS.map((filter) => filter.id)).toEqual(['none', 'mono', 'warm', 'beauty']);
    expect(PHOTO_FILTERS.map((filter) => filter.label)).toEqual(['Original', 'Black & white', 'Warm', 'Beauty']);
    expect(photoFilterLabel('warm')).toBe('Warm');
    expect(isPhotoFilterId('mono')).toBe(true);
    expect(isPhotoFilterId('sepia')).toBe(false);
    expect(isPhotoFilterId(null)).toBe(false);
  });

  it('describes each look as draw passes, with beauty as a sharp plus a soft pass', () => {
    expect(filterPasses('none')).toEqual([]);
    expect(filterPasses('mono')).toEqual([{ filter: 'grayscale(1) contrast(1.06)', alpha: 1 }]);
    expect(filterPasses('warm')[0]).toMatchObject({ alpha: 1 });
    expect(filterPasses('warm')[0]?.filter).toContain('sepia(0.32)');
    const beauty = filterPasses('beauty');
    expect(beauty).toHaveLength(2);
    expect(beauty[1]).toEqual({ filter: 'blur(6px)', alpha: 0.35 });
    expect(() => filterPasses('vintage' as never)).toThrow(/Unknown photo filter/);
  });

  it('draws the original once, untouched', () => {
    const { ctx, draws } = context();
    drawFiltered(ctx, 'none', (drawing) => drawing.drawImage({} as never, 0, 0, 10, 10));
    expect(draws).toEqual([{ filter: 'none', alpha: 1 }]);
  });

  it('draws every pass in order with its own filter and alpha', () => {
    const { ctx, draws } = context();
    drawFiltered(ctx, 'beauty', (drawing) => drawing.drawImage({} as never, 0, 0, 10, 10));
    expect(draws).toEqual([
      { filter: 'brightness(1.05) saturate(1.05)', alpha: 1 },
      { filter: 'blur(6px)', alpha: 0.35 },
    ]);
  });

  it('clips a blurred pass to the photo box and restores the context afterwards', () => {
    const { ctx, clipped } = context();
    drawFiltered(ctx, 'beauty', (drawing) => drawing.drawImage({} as never, 0, 0, 10, 10), { x: 5, y: 6, width: 100, height: 150 });
    expect(clipped).toEqual([[5, 6, 100, 150]]);
    expect(ctx.filter).toBe('none');
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('restores the context even when the draw throws', () => {
    const { ctx } = context();
    expect(() => drawFiltered(ctx, 'mono', () => { throw new Error('no bitmap'); })).toThrow('no bitmap');
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('gives a CSS equivalent for thumbnails, with nothing applied to the original', () => {
    expect(cssPhotoFilter('none')).toBe('none');
    expect(cssPhotoFilter('mono')).toBe('grayscale(1) contrast(1.06)');
    expect(cssPhotoFilter('warm')).toContain('sepia(0.32)');
    expect(cssPhotoFilter('beauty')).toContain('blur(0.6px)');
  });
});
