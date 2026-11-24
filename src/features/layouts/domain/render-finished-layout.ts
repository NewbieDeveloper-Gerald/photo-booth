import { coverCrop } from './cover-crop';
import { bytesToJpegBlob } from '../../../shared/dom/blob';
import type { LayoutPreset } from '../catalog';
import type { SessionRecord } from '../../../shared/types/session';

export type FinishedLayoutBranding = { primaryColor: string; accentColor: string; thankYouText: string; logoDataUrl: string | null };
export type FinishedLayoutBridge = { readOriginalPhoto(photoId: string): Promise<Uint8Array> };

// Geometry of the 300 dpi layout, in layout pixels. Changing these changes printed output.
const HEADER_HEIGHT = 112;
const HEADER_TEXT_BASELINE = 56;
const HEADER_TEXT_MAX_WIDTH = 80;
const HEADER_TEXT_QR_RESERVE = 160;
const HEADER_TEXT_QR_OFFSET = 128;
const LOGO_MARGIN = 12;
const LOGO_MAX = 88;
const QR_PANEL_MARGIN = 8;
const QR_PANEL_SIZE = 104;
const QR_INSET = 12;
const QR_SIZE = 96;
const FOOTER_HEIGHT = 62;
const FOOTER_TEXT_MAX_WIDTH_MARGIN = 60;

/** Draws the finished 4×6 image: brand bands, logo, guest QR and centre-cropped slot photos. */
export async function renderFinishedLayout(bridge: FinishedLayoutBridge, record: SessionRecord, eventName: string, layout: LayoutPreset, qrDataUrl?: string, branding?: FinishedLayoutBranding): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the finished layout.');
  context.fillStyle = branding?.accentColor ?? layout.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = branding?.primaryColor ?? layout.frameColor;
  context.fillRect(0, 0, canvas.width, HEADER_HEIGHT);
  context.fillStyle = '#ffffff';
  context.font = `700 ${layout.header.fontSize}px Inter, Segoe UI, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(layout.header.text.replace('{{eventName}}', eventName), qrDataUrl ? (canvas.width - HEADER_TEXT_QR_OFFSET) / 2 : canvas.width / 2, HEADER_TEXT_BASELINE, canvas.width - (qrDataUrl ? HEADER_TEXT_QR_RESERVE : HEADER_TEXT_MAX_WIDTH));
  if (branding?.logoDataUrl) {
    const logoBitmap = await createImageBitmap(await (await fetch(branding.logoDataUrl)).blob());
    const scale = Math.min(LOGO_MAX / logoBitmap.width, LOGO_MAX / logoBitmap.height);
    context.drawImage(logoBitmap, LOGO_MARGIN, LOGO_MARGIN, logoBitmap.width * scale, logoBitmap.height * scale);
    logoBitmap.close();
  }
  if (qrDataUrl) {
    const qrBitmap = await createImageBitmap(await (await fetch(qrDataUrl)).blob());
    context.fillStyle = '#ffffff';
    context.fillRect(canvas.width - QR_PANEL_SIZE - QR_PANEL_MARGIN, QR_PANEL_MARGIN, QR_PANEL_SIZE, QR_PANEL_SIZE);
    context.drawImage(qrBitmap, canvas.width - QR_SIZE - QR_INSET, QR_INSET, QR_SIZE, QR_SIZE);
    qrBitmap.close();
  }

  const bitmaps: ImageBitmap[] = [];
  try {
    for (const region of layout.placements) {
      const slot = record.slots.find((item) => item.slotNumber === region.slot);
      if (!slot?.photoId) throw new Error(`Photo ${region.slot} is missing from this session.`);
      const bitmap = await createImageBitmap(bytesToJpegBlob(await bridge.readOriginalPhoto(slot.photoId)));
      bitmaps.push(bitmap);
      const crop = coverCrop(bitmap.width, bitmap.height, region.width, region.height);
      context.fillStyle = '#ffffff';
      context.fillRect(region.x - layout.gutter / 2, region.y - layout.gutter / 2, region.width + layout.gutter, region.height + layout.gutter);
      context.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, region.x, region.y, region.width, region.height);
    }
  } finally { for (const bitmap of bitmaps) bitmap.close(); }

  context.fillStyle = branding?.primaryColor ?? layout.frameColor;
  context.fillRect(0, canvas.height - FOOTER_HEIGHT, canvas.width, FOOTER_HEIGHT);
  context.fillStyle = layout.footer.color;
  context.font = `500 ${layout.footer.fontSize}px Inter, Segoe UI, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(branding?.thankYouText ?? layout.footer.text, canvas.width / 2, canvas.height - FOOTER_HEIGHT / 2, canvas.width - FOOTER_TEXT_MAX_WIDTH_MARGIN);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the finished layout.')), 'image/jpeg', 0.96));
}
