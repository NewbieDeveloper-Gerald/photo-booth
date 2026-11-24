import {
  BOOMERANG_DELAY_CS, SLIDESHOW_DELAY_CS, boomerangOrder, encodeGif, fitWithinSize, framesForBudget,
  MAX_ANIMATION_BYTES, pickBurstFrames, type GifFrame,
} from '../../features/animation';

/**
 * Turns photos and burst frames into the bytes of a loop (F23). Canvas work lives here; the
 * plan (how many frames, in what order, how big) and the encoder stay in the pure feature.
 */
/** Any image the browser can decode: a blob URL, an object URL or a data URL. */
export type AnimationSource = string;

export type BuiltAnimation = { bytes: Uint8Array; width: number; height: number; frameCount: number };

async function decode(url: string): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  try {
    const response = await fetch(url);
    const bitmap = await createImageBitmap(await response.blob());
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

function scaledFrame(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): GifFrame {
  const size = fitWithinSize(sourceWidth, sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This device cannot draw the animation');
  context.drawImage(source, 0, 0, size.width, size.height);
  const { data } = context.getImageData(0, 0, size.width, size.height);
  return { rgba: new Uint8Array(data.buffer.slice(0)) };
}

/**
 * The photos of a session, held for about half a second each. A photo that cannot be decoded is
 * skipped rather than failing the whole loop: the guest still has the photos themselves.
 */
export async function buildSlideshowGif(sources: AnimationSource[]): Promise<BuiltAnimation | null> {
  const frames: GifFrame[] = [];
  let width = 0;
  let height = 0;
  for (const source of sources) {
    const image = await decode(source);
    if (!image) continue;
    const frame = scaledFrame(image.source, image.width, image.height);
    if (frames.length === 0) ({ width, height } = fitWithinSize(image.width, image.height));
    // Every frame must share the GIF's size; a photo with another aspect is letterboxed.
    frames.push(frame);
  }
  if (frames.length === 0) return null;
  return fitAndEncode(frames, width, height, SLIDESHOW_DELAY_CS);
}

/** A burst played forward and straight back, which is what makes it read as motion. */
export async function buildBoomerangGif(sources: AnimationSource[]): Promise<BuiltAnimation | null> {
  const picked = pickBurstFrames(sources.length);
  const frames: GifFrame[] = [];
  let width = 0;
  let height = 0;
  for (const index of picked) {
    const source = sources[index];
    if (!source) continue;
    const image = await decode(source);
    if (!image) continue;
    if (frames.length === 0) ({ width, height } = fitWithinSize(image.width, image.height));
    frames.push(scaledFrame(image.source, image.width, image.height));
  }
  if (frames.length < 2) return null;
  const order = boomerangOrder(frames.length);
  const paced = order.map((index) => frames[index]!);
  return fitAndEncode(paced, width, height, BOOMERANG_DELAY_CS);
}

/**
 * Frames from different photos can differ by a pixel or two in size (rounding); everything is
 * padded onto one canvas at the first frame's size, and a loop that still comes out too heavy
 * is rebuilt with fewer frames so a phone on mobile data can open it.
 */
function fitAndEncode(frames: GifFrame[], width: number, height: number, delayCs: number): BuiltAnimation {
  const normalized = frames.map((frame) => normalize(frame, width, height));
  let bytes = encodeGif(normalized, { width, height, delayCs });
  let kept = normalized;
  while (bytes.length > MAX_ANIMATION_BYTES && kept.length > 1) {
    const indices = framesForBudget(kept.length, bytes.length);
    kept = indices.map((index) => kept[index]!);
    bytes = encodeGif(kept, { width, height, delayCs });
  }
  return { bytes: new Uint8Array(bytes), width, height, frameCount: kept.length };
}

function normalize(frame: GifFrame, width: number, height: number): GifFrame {
  const frameWidth = Math.round(frame.rgba.length / 4 / height);
  if (frameWidth === width) return frame;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(frameWidth, width);
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return frame;
  const image = context.createImageData(Math.max(frameWidth, width), height);
  image.data.set(frame.rgba.subarray(0, image.data.length));
  context.putImageData(image, 0, 0);
  const padded = context.getImageData(0, 0, width, height);
  return { rgba: new Uint8Array(padded.data.buffer.slice(0)) };
}
