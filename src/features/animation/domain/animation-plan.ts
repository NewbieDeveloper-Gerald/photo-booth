/**
 * What animated extra a session gets (F23). Two shapes, both small enough to open on a phone
 * over mobile data: a slideshow GIF of the session's photos, and a boomerang that plays a short
 * burst forward and straight back.
 */
export type AnimatedOutput = 'none' | 'gif' | 'boomerang' | 'both';

export const ANIMATED_OUTPUTS: AnimatedOutput[] = ['none', 'gif', 'boomerang', 'both'];

/** 320 px on the long edge keeps a loop under a few hundred kilobytes. */
export const ANIMATION_MAX_EDGE_PX = 320;
/** A photo is held for 0.6 s, long enough to read on a phone. */
export const SLIDESHOW_DELAY_CS = 60;
/** A boomerang is a burst: 10 frames per second, so forward-back reads as motion. */
export const BOOMERANG_DELAY_CS = 10;
export const MAX_BOOMERANG_FRAMES = 6;
export const MIN_BOOMERANG_FRAMES = 3;
/** Above this the file is too heavy for a phone on mobile data. */
export const MAX_ANIMATION_BYTES = 400 * 1024;

export function isAnimatedOutput(value: unknown): value is AnimatedOutput {
  return typeof value === 'string' && (ANIMATED_OUTPUTS as readonly string[]).includes(value);
}

export function wantsSlideshow(kind: AnimatedOutput): boolean {
  return kind === 'gif' || kind === 'both';
}

export function wantsBoomerang(kind: AnimatedOutput): boolean {
  return kind === 'boomerang' || kind === 'both';
}

/** The order a boomerang plays: forward, then back without repeating either end. */
export function boomerangOrder(frameCount: number): number[] {
  if (frameCount < 2) return Array.from({ length: Math.max(0, frameCount) }, (_, index) => index);
  const forward = Array.from({ length: frameCount }, (_, index) => index);
  const back = Array.from({ length: frameCount - 2 }, (_, index) => frameCount - 2 - index);
  return [...forward, ...back];
}

/** Evenly spread a long burst over the frames that fit, keeping the first and the last. */
export function pickBurstFrames(frameCount: number, max = MAX_BOOMERANG_FRAMES): number[] {
  if (frameCount <= max) return Array.from({ length: Math.max(0, frameCount) }, (_, index) => index);
  if (max <= 1) return frameCount > 0 ? [0] : [];
  const picked = new Set<number>([0, frameCount - 1]);
  for (let step = 1; step < max - 1; step += 1) picked.add(Math.round((step * (frameCount - 1)) / (max - 1)));
  return [...picked].sort((left, right) => left - right);
}

/** Fit an image into the animation size without stretching it. */
export function fitWithinSize(width: number, height: number, maxEdge = ANIMATION_MAX_EDGE_PX): { width: number; height: number } {
  if (width < 1 || height < 1) throw new Error('Invalid animation frame size');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The encoder cannot know how well a photo compresses, so the budget is applied after the
 * fact: a loop that came out too heavy is rebuilt with fewer frames, and one frame is the
 * floor. The caller re-encodes; this only says which frames to keep.
 */
export function framesForBudget(frameCount: number, previousBytes: number | null, maxBytes = MAX_ANIMATION_BYTES): number[] {
  const all = Array.from({ length: frameCount }, (_, index) => index);
  if (previousBytes === null || previousBytes <= maxBytes || frameCount <= 1) return all;
  const keep = Math.max(1, Math.floor((frameCount * maxBytes) / previousBytes));
  return pickBurstFrames(frameCount, Math.max(1, keep));
}
