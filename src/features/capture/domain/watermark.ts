import type { WatermarkPosition, WatermarkSettings } from '../../../shared/types/watermark';

export type { WatermarkPosition, WatermarkSettings };

export type WatermarkPlacement = { x: number; y: number; width: number; height: number };

/** Keeps the mark off the very edge without letting it drift into the subject. */
const WATERMARK_MARGIN_RATIO = 0.04;

const VALID_POSITIONS: WatermarkPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];

export function isWatermarkPosition(value: unknown): value is WatermarkPosition {
  return typeof value === 'string' && (VALID_POSITIONS as string[]).includes(value);
}

/**
 * Where the logo sits on a guest copy. Sizing is relative to the photo, so the same event
 * setting looks identical on a 2048 px copy whether the camera shot landscape or portrait.
 */
export function watermarkPlacement({
  photoWidth, photoHeight, logoWidth, logoHeight, settings,
}: { photoWidth: number; photoHeight: number; logoWidth: number; logoHeight: number; settings: WatermarkSettings }): WatermarkPlacement {
  if ([photoWidth, photoHeight, logoWidth, logoHeight].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('Watermark needs positive photo and logo dimensions');
  }
  // A tall logo is limited by the photo height, so its aspect ratio is never squashed.
  const fitsHeight = photoHeight * (logoWidth / logoHeight);
  // Floor, not round: rounding up could push the height back over the photo edge.
  const width = Math.max(1, Math.floor(Math.min(photoWidth * (settings.scalePercent / 100), photoWidth, fitsHeight)));
  const height = Math.max(1, Math.round(width * (logoHeight / logoWidth)));
  const margin = Math.round(Math.min(photoWidth, photoHeight) * WATERMARK_MARGIN_RATIO);
  const maxX = Math.max(0, photoWidth - width);
  const maxY = Math.max(0, photoHeight - height);
  const centeredX = Math.round((photoWidth - width) / 2);
  const centeredY = Math.round((photoHeight - height) / 2);
  const x = settings.position === 'center' ? centeredX : settings.position.endsWith('left') ? margin : maxX - margin;
  const y = settings.position === 'center' ? centeredY : settings.position.startsWith('top') ? margin : maxY - margin;
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY), width, height };
}

type DrawableContext = Pick<CanvasRenderingContext2D, 'drawImage' | 'globalAlpha' | 'save' | 'restore'>;

/**
 * Draws the mark on a download copy only. Originals are written straight from the camera
 * and never pass through here, which is what keeps the backup clean (F17).
 */
export function drawWatermark(context: DrawableContext, logo: CanvasImageSource, placement: WatermarkPlacement, opacity: number): void {
  const alpha = Math.min(1, Math.max(0.1, opacity));
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(logo, placement.x, placement.y, placement.width, placement.height);
  context.restore();
}
