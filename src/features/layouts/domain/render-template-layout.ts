import { bytesToJpegBlob } from '../../../shared/dom/blob';
import type { SessionRecord } from '../../../shared/types/session';
import { coverCrop } from './cover-crop';
import { drawFiltered, type PhotoFilterId } from '../../capture/domain/photo-filters';
import type { QrElement, TemplateDocument } from './template-document';
import { computeTextPlacement, paintOrder, type PaintContext } from './template-paint-plan';

export type TemplateBranding = { primaryColor: string; accentColor: string; thankYouText: string; logoDataUrl: string | null };
export type TemplateBridge = { readOriginalPhoto(photoId: string): Promise<Uint8Array> };

const BRAND_FONT = 'Inter, Segoe UI, sans-serif';
const JPEG_QUALITY = 0.96;

async function loadBitmap(dataUrl: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

function drawQrElement(context: CanvasRenderingContext2D, element: QrElement, bitmap: ImageBitmap): void {
  context.fillStyle = element.panelColor;
  context.fillRect(element.x, element.y, element.width, element.height);
  context.drawImage(bitmap, element.x + element.inset, element.y + element.inset, element.width - 2 * element.inset, element.height - 2 * element.inset);
}

/**
 * Draws a finished layout from the stored template: brand bands, slot photos with
 * their frames, text, logo, guest QR. Every position comes from the template, so a
 * new page size needs no renderer change.
 */
export async function renderTemplateLayout(
  bridge: TemplateBridge,
  record: SessionRecord,
  template: TemplateDocument,
  options: { eventName: string; qrDataUrl?: string; branding?: TemplateBranding; photoFilter?: PhotoFilterId } = { eventName: '' },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = template.page.widthPx;
  canvas.height = template.page.heightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the finished layout.');
  const paint: PaintContext = { eventName: options.eventName, thankYouText: options.branding?.thankYouText ?? null, drawQr: Boolean(options.qrDataUrl) };
  const hasQrElement = template.elements.some((element) => element.kind === 'qr');
  const qrBitmap = options.qrDataUrl && hasQrElement ? await loadBitmap(options.qrDataUrl) : null;
  const logoBitmap = options.branding?.logoDataUrl ? await loadBitmap(options.branding.logoDataUrl) : null;
  const bitmaps: ImageBitmap[] = [];
  if (qrBitmap) bitmaps.push(qrBitmap);
  if (logoBitmap) bitmaps.push(logoBitmap);

  try {
    for (const element of paintOrder(template)) {
      if (element.kind === 'rect') {
        context.fillStyle = element.color;
        context.fillRect(element.x, element.y, element.width, element.height);
      } else if (element.kind === 'photo') {
        const slot = record.slots.find((item) => item.slotNumber === element.slotNumber);
        if (!slot?.photoId) throw new Error(`Photo ${element.slotNumber} is missing from this session.`);
        const bitmap = await createImageBitmap(bytesToJpegBlob(await bridge.readOriginalPhoto(slot.photoId)));
        bitmaps.push(bitmap);
        const crop = coverCrop(bitmap.width, bitmap.height, element.width, element.height);
        context.fillStyle = '#ffffff';
        context.fillRect(element.x - element.frameGutter / 2, element.y - element.frameGutter / 2, element.width + element.frameGutter, element.height + element.frameGutter);
        // The session's look is baked into the finished image (and so into the print); the
        // original stays clean (F20). The clip keeps a blurred pass inside the photo box.
        drawFiltered(context, options.photoFilter ?? 'none',
          (drawing) => drawing.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, element.x, element.y, element.width, element.height),
          { x: element.x, y: element.y, width: element.width, height: element.height });
      } else if (element.kind === 'text') {
        const placement = computeTextPlacement(element, paint);
        if (!placement.text) continue;
        context.fillStyle = placement.color;
        context.font = `${placement.fontWeight} ${placement.fontSize}px ${BRAND_FONT}`;
        context.textAlign = placement.align;
        context.textBaseline = 'middle';
        context.fillText(placement.text, placement.x, placement.y, placement.maxWidth);
      } else if (element.kind === 'logo' && logoBitmap) {
        const scale = Math.min(element.width / logoBitmap.width, element.height / logoBitmap.height);
        context.drawImage(logoBitmap, element.x, element.y, logoBitmap.width * scale, logoBitmap.height * scale);
      } else if (element.kind === 'qr' && qrBitmap) {
        drawQrElement(context, element, qrBitmap);
      }
    }
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }

  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the finished layout.')), 'image/jpeg', JPEG_QUALITY));
}
