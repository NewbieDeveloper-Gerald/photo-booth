// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAttractSlides } from './attract-slides';
import type { AttractMedia } from '../../shared/types/attract';

type Bridge = NonNullable<Window['photobooth']>;

const media: AttractMedia[] = [
  { id: 'party-1234abcd.png', kind: 'image', label: 'party.png', bytes: 3 },
  { id: 'clip-1234abcd.mp4', kind: 'video', label: 'clip.mp4', bytes: 4 },
];

function bridgeWith(files: Record<string, { kind: 'image' | 'video'; mimeType: string; bytes: Uint8Array }>): Bridge {
  return { readAttractMedia: vi.fn(async (_eventId: string, mediaId: string) => files[mediaId]!) } as unknown as Bridge;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('attract slides (F19)', () => {
  it('turns each stored file into one blob URL of the right type', async () => {
    const created: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn((blob: Blob) => { const url = `blob:${blob.type}:${created.length}`; created.push(url); return url; }), revokeObjectURL: vi.fn() });
    const bridge = bridgeWith({
      'party-1234abcd.png': { kind: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) },
      'clip-1234abcd.mp4': { kind: 'video', mimeType: 'video/mp4', bytes: new Uint8Array([2]) },
    });
    const { slides } = await loadAttractSlides(bridge, 'event-1', media);
    expect(slides).toEqual([
      { id: 'party-1234abcd.png', kind: 'image', label: 'party.png', url: 'blob:image/png:0' },
      { id: 'clip-1234abcd.mp4', kind: 'video', label: 'clip.mp4', url: 'blob:video/mp4:1' },
    ]);
    vi.unstubAllGlobals();
  });

  it('revokes every URL it made when the loop is released', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:slide'), revokeObjectURL: revoke });
    const bridge = bridgeWith({ 'party-1234abcd.png': { kind: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) } });
    const { release } = await loadAttractSlides(bridge, 'event-1', media.slice(0, 1));
    release();
    expect(revoke).toHaveBeenCalledWith('blob:slide');
    vi.unstubAllGlobals();
  });

  it('releases what it made when a file cannot be read', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:slide'), revokeObjectURL: revoke });
    const bridge = { readAttractMedia: vi.fn(async () => { throw new Error('file gone'); }) } as unknown as Bridge;
    await expect(loadAttractSlides(bridge, 'event-1', media)).rejects.toThrow('file gone');
    expect(revoke).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
