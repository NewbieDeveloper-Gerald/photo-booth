import type { AttractMedia } from '../../shared/types/attract';
import { bytesToBlob } from '../../shared/dom/blob';

/** One slide of the idle loop: an image or a clip, already turned into a blob URL. */
export type AttractSlide = { id: string; kind: 'image' | 'video'; label: string; url: string };

type Bridge = NonNullable<Window['photobooth']>;

/**
 * Reads the event's attract files once per event and hands back blob URLs. A loop that
 * re-read 25 MB clips every slide would stutter, and data URLs would double the memory.
 * `release()` revokes every URL, so switching events does not leak them.
 */
export async function loadAttractSlides(bridge: Bridge, eventId: string, media: AttractMedia[]): Promise<{ slides: AttractSlide[]; release: () => void }> {
  const slides: AttractSlide[] = [];
  const release = (): void => { for (const slide of slides) URL.revokeObjectURL(slide.url); };
  try {
    for (const item of media) {
      const file = await bridge.readAttractMedia(eventId, item.id);
      slides.push({ id: item.id, kind: file.kind, label: item.label, url: URL.createObjectURL(bytesToBlob(file.bytes, file.mimeType)) });
    }
  } catch (error) {
    release();
    throw error;
  }
  return { slides, release };
}
