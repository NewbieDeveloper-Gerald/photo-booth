import { getPagePreset } from '../../features/layouts/domain/template-document';

/** Two 2 × 6 strips side by side on one 4 × 6 sheet, at the preset's 300 dpi. */
const CUT_SHEET_PAGE_ID = '4x6';

export type CutSheet = { blob: Blob; width: number; height: number };

/**
 * A 2 × 6 strip is cut by hand after printing, which wastes paper and time at a busy event.
 * Pairing two strips on one 4 × 6 sheet gives one cut down the middle (F18). The strips keep
 * their own pixels, so nothing is resampled and both guests' copies stay identical.
 */
export async function composeStripCutSheet(strip: Blob, stripWidth: number, stripHeight: number): Promise<CutSheet> {
  const page = getPagePreset(CUT_SHEET_PAGE_ID);
  if (stripWidth * 2 !== page.widthPx || stripHeight !== page.heightPx) {
    throw new Error(`The strip must be ${page.widthPx / 2} by ${page.heightPx} pixels to pair on one ${page.label} sheet`);
  }
  const image = await createImageBitmap(strip);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = page.widthPx;
    canvas.height = page.heightPx;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The print sheet could not be drawn');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, stripWidth, stripHeight);
    context.drawImage(image, stripWidth, 0, stripWidth, stripHeight);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('The print sheet could not be saved');
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    image.close();
  }
}
