export type Rect = { x: number; y: number; width: number; height: number };
export type CropRect = { sx: number; sy: number; sw: number; sh: number };

export function coverCrop(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): CropRect {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError('Image and target dimensions must be positive');
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const sw = sourceHeight * targetRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

export function isInsideCanvas(rect: Rect, canvasWidth: number, canvasHeight: number): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 &&
    rect.x + rect.width <= canvasWidth && rect.y + rect.height <= canvasHeight;
}
