// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeStripCutSheet } from './print-sheet';

type Calls = { fillRect: unknown[][]; drawImage: unknown[][]; width: number; height: number; fillStyle: string };

/** jsdom has no canvas, so the composer is checked against a recording 2D context. */
function stubCanvas(): Calls {
  const calls: Calls = { fillRect: [], drawImage: [], width: 0, height: 0, fillStyle: '' };
  const context = {
    set fillStyle(value: string) { calls.fillStyle = value; },
    get fillStyle(): string { return calls.fillStyle; },
    fillRect: (...args: unknown[]) => { calls.fillRect.push(args); },
    drawImage: (...args: unknown[]) => { calls.drawImage.push(args); },
  };
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas') return original(tagName);
    const canvas = {
      width: 0, height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })),
    };
    const proxy = new Proxy(canvas, {
      set(target, property, value) { if (property === 'width' || property === 'height') calls[property] = Number(value); return Reflect.set(target, property, value); },
    });
    return proxy as unknown as HTMLElement;
  }) as typeof document.createElement);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
  return calls;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('strip cut sheet (F18)', () => {
  it('pairs two 2 × 6 strips on one 4 × 6 sheet with a white background', async () => {
    const calls = stubCanvas();
    const sheet = await composeStripCutSheet(new Blob(['strip']), 600, 1800);
    expect(sheet).toMatchObject({ width: 1200, height: 1800 });
    expect(calls.fillRect).toEqual([[0, 0, 1200, 1800]]);
    expect(calls.fillStyle).toBe('#ffffff');
    // Left copy then right copy, each at its own size so nothing is resampled.
    expect(calls.drawImage.map((args) => args.slice(1))).toEqual([[0, 0, 600, 1800], [600, 0, 600, 1800]]);
    expect(sheet.blob.type).toBe('image/jpeg');
  });

  it('refuses anything that is not a 2 × 6 strip', async () => {
    stubCanvas();
    await expect(composeStripCutSheet(new Blob(['layout']), 1200, 1800)).rejects.toThrow('The strip must be 600 by 1800 pixels');
  });
});
