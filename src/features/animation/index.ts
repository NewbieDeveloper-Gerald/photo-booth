/** Renderer-safe surface: the encoder and the plan are pure, so the booth window builds loops. */
export { GIF_MAX_EDGE_PX, colorTable, encodeGif, paletteIndex } from './domain/gif-encoder';
export type { GifFrame, GifOptions } from './domain/gif-encoder';
export {
  ANIMATED_OUTPUTS, ANIMATION_MAX_EDGE_PX, BOOMERANG_DELAY_CS, MAX_ANIMATION_BYTES, MAX_BOOMERANG_FRAMES,
  MIN_BOOMERANG_FRAMES, SLIDESHOW_DELAY_CS, boomerangOrder, fitWithinSize, framesForBudget, isAnimatedOutput,
  pickBurstFrames, wantsBoomerang, wantsSlideshow,
} from './domain/animation-plan';
export type { AnimatedOutput } from './domain/animation-plan';
