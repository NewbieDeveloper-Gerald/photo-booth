// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createDownloadCopy, fitDimensions } from './photo-pipeline';

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

/** jsdom has no canvas: a recording context and a stub bitmap stand in for the real things. */
function stubCanvasEnvironment(): { draws: Array<{ filter: string; alpha: number; width: number; height: number }>; restoreMocks: () => void } {
  const draws: Array<{ filter: string; alpha: number; width: number; height: number }> = [];
  const state = { filter: 'none', globalAlpha: 1 };
  const context = {
    get filter() { return state.filter; },
    set filter(value: string) { state.filter = value; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(value: number) { state.globalAlpha = value; },
    save() {}, restore() { state.filter = 'none'; state.globalAlpha = 1; },
    beginPath() {}, rect() {}, clip() {}, fillRect() {}, fillStyle: '#fff',
    drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => { draws.push({ filter: state.filter, alpha: state.globalAlpha, width, height }); },
  };
  const originalCreate = document.createElement.bind(document);
  const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas') return originalCreate(tagName);
    return {
      width: 0, height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([new Uint8Array([1])], { type: 'image/jpeg' })),
    } as unknown as HTMLElement;
  }) as typeof document.createElement);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
  return {
    draws,
    restoreMocks: () => { createSpy.mockRestore(); vi.unstubAllGlobals(); },
  };
}

describe('createDownloadCopy looks (F20)', () => {
  it('draws the scaled guest copy through the session look', async () => {
    const { draws, restoreMocks } = stubCanvasEnvironment();
    try {
      const copy = await createDownloadCopy(new Blob(['photo']), { filter: 'mono' });
      expect(copy).toMatchObject({ width: 2048, height: 1536 });
      expect(draws).toEqual([{ filter: 'grayscale(1) contrast(1.06)', alpha: 1, width: 2048, height: 1536 }]);
    } finally { restoreMocks(); }
  });

  it('leaves the copy untouched for the original look, and still draws a watermark on top', async () => {
    const { draws, restoreMocks } = stubCanvasEnvironment();
    try {
      await createDownloadCopy(new Blob(['photo']), { filter: 'none', watermark: { logo: {} as never, logoWidth: 200, logoHeight: 100, settings: { position: 'bottom-right', scalePercent: 18, opacity: 0.6 } } });
      expect(draws).toHaveLength(2);
      expect(draws[0]).toEqual({ filter: 'none', alpha: 1, width: 2048, height: 1536 });
      // The mark is drawn after the look, with the event's own opacity.
      expect(draws[1]).toMatchObject({ filter: 'none', alpha: 0.6, width: 368, height: 184 });
    } finally { restoreMocks(); }
  });
});
