import type { PhotoFilterId } from '../../../shared/types/photo-filter';

export type { PhotoFilterId } from '../../../shared/types/photo-filter';

export type PhotoFilterOption = {
  id: PhotoFilterId;
  label: string;
  /** One line for the operator, so the choice is not a mystery word. */
  description: string;
  /** Swatch colour pair, used by the picker before any photo exists. */
  swatch: [string, string];
};

/** The order guests see: the plain photo first, then the looks. */
export const PHOTO_FILTERS: PhotoFilterOption[] = [
  { id: 'none', label: 'Original', description: 'The photo as the camera saw it.', swatch: ['#7c8aa5', '#c9b4ff'] },
  { id: 'mono', label: 'Black & white', description: 'Greyscale with a little extra contrast.', swatch: ['#2f3542', '#e8e8ee'] },
  { id: 'warm', label: 'Warm', description: 'Golden skin tones and a softer sky.', swatch: ['#a8622a', '#f3c98b'] },
  { id: 'beauty', label: 'Beauty', description: 'Soft-focus smoothing with a gentle lift.', swatch: ['#b98a86', '#fbe3dc'] },
];

const FILTER_IDS: PhotoFilterId[] = PHOTO_FILTERS.map((filter) => filter.id);

export function isPhotoFilterId(value: unknown): value is PhotoFilterId {
  return typeof value === 'string' && (FILTER_IDS as string[]).includes(value);
}

export function photoFilterLabel(id: PhotoFilterId): string {
  return PHOTO_FILTERS.find((filter) => filter.id === id)?.label ?? 'Original';
}

/**
 * A look is a list of draw passes, not a single canvas filter string: beauty is the photo
 * drawn once sharp and once blurred over itself, which is the cheapest honest smoothing a
 * 2D canvas can do. `none` is one plain pass, so the caller never special-cases it.
 */
export type FilterPass = { filter: string; alpha: number };

const PASSES: Record<PhotoFilterId, FilterPass[]> = {
  none: [],
  mono: [{ filter: 'grayscale(1) contrast(1.06)', alpha: 1 }],
  warm: [{ filter: 'sepia(0.32) saturate(1.22) brightness(1.04) contrast(1.02)', alpha: 1 }],
  // The blurred pass is translucent, so edges stay where the photo puts them.
  beauty: [
    { filter: 'brightness(1.05) saturate(1.05)', alpha: 1 },
    { filter: 'blur(6px)', alpha: 0.35 },
  ],
};

export function filterPasses(id: PhotoFilterId): FilterPass[] {
  const passes = PASSES[id];
  if (!passes) throw new Error(`Unknown photo filter: ${String(id)}`);
  return passes.map((pass) => ({ ...pass }));
}

/**
 * The same look as a CSS filter, for thumbnails and swatches. The beauty blur is scaled down
 * because a preview is a fraction of the print's size, and the live camera preview is left
 * unfiltered so a 4K stream never pays for a blur.
 */
export function cssPhotoFilter(id: PhotoFilterId): string {
  switch (id) {
    case 'mono': return 'grayscale(1) contrast(1.06)';
    case 'warm': return 'sepia(0.32) saturate(1.22) brightness(1.04)';
    case 'beauty': return 'brightness(1.05) saturate(1.05) blur(0.6px)';
    default: return 'none';
  }
}

export type ClipRect = { x: number; y: number; width: number; height: number };

/**
 * Draws a photo through a look. The clip keeps a blurred pass inside the photo box, so a
 * layout's white frames and brand bands never pick up a halo. Canvas state is restored even
 * when the draw throws, leaving the caller's context exactly as it was.
 */
export function drawFiltered(
  context: CanvasRenderingContext2D,
  id: PhotoFilterId,
  draw: (context: CanvasRenderingContext2D) => void,
  clip?: ClipRect,
): void {
  const passes = filterPasses(id);
  context.save();
  try {
    if (clip) {
      context.beginPath();
      context.rect(clip.x, clip.y, clip.width, clip.height);
      context.clip();
    }
    if (passes.length === 0) { draw(context); return; }
    for (const pass of passes) {
      context.filter = pass.filter;
      context.globalAlpha = pass.alpha;
      draw(context);
    }
  } finally {
    context.restore();
  }
}
