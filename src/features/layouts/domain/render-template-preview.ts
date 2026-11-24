import type { TemplateDocument } from './template-document';
import { computeTextPlacement, paintOrder, type PaintContext } from './template-paint-plan';

const PREVIEW_BACKGROUND = '#e5e7eb';
const PREVIEW_PHOTO = '#cbd5e1';
const BRAND_FONT = 'Inter, Segoe UI, sans-serif';

/**
 * Editor preview: identical geometry to the printed layout, but slot photos are grey
 * placeholders with their number, so the operator sees exactly what will be printed
 * without needing a session.
 */
export function paintTemplatePreview(
  context: CanvasRenderingContext2D,
  template: TemplateDocument,
  options: { eventName?: string; thankYouText?: string; qr?: ImageBitmap | null; logo?: ImageBitmap | null; images?: Map<string, ImageBitmap> } = {},
): void {
  const paint: PaintContext = { eventName: options.eventName ?? 'Your event', thankYouText: options.thankYouText ?? null, drawQr: Boolean(options.qr) };
  for (const element of paintOrder(template)) {
    if (element.kind === 'image') {
      const bitmap = options.images?.get(element.assetName);
      if (bitmap) context.drawImage(bitmap, element.x, element.y, element.width, element.height);
      else { context.fillStyle = PREVIEW_BACKGROUND; context.fillRect(element.x, element.y, element.width, element.height); }
    } else if (element.kind === 'rect') {
      context.fillStyle = element.color;
      context.fillRect(element.x, element.y, element.width, element.height);
    } else if (element.kind === 'photo') {
      context.fillStyle = PREVIEW_BACKGROUND;
      context.fillRect(element.x - element.frameGutter / 2, element.y - element.frameGutter / 2, element.width + element.frameGutter, element.height + element.frameGutter);
      context.fillStyle = PREVIEW_PHOTO;
      context.fillRect(element.x, element.y, element.width, element.height);
      context.fillStyle = '#475569';
      context.font = `600 ${Math.max(14, Math.round(element.width * 0.12))}px ${BRAND_FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(element.slotNumber), element.x + element.width / 2, element.y + element.height / 2, element.width * 0.8);
    } else if (element.kind === 'text') {
      const placement = computeTextPlacement(element, paint);
      if (!placement.text) continue;
      context.fillStyle = placement.color;
      context.font = `${placement.fontWeight} ${placement.fontSize}px ${BRAND_FONT}`;
      context.textAlign = placement.align;
      context.textBaseline = 'middle';
      context.fillText(placement.text, placement.x, placement.y, placement.maxWidth);
    } else if (element.kind === 'logo') {
      if (options.logo) {
        const scale = Math.min(element.width / options.logo.width, element.height / options.logo.height);
        context.drawImage(options.logo, element.x, element.y, options.logo.width * scale, options.logo.height * scale);
      } else {
        context.strokeStyle = '#94a3b8';
        context.lineWidth = 2;
        context.strokeRect(element.x, element.y, element.width, element.height);
        context.fillStyle = '#64748b';
        context.font = `500 ${Math.max(10, Math.round(element.width * 0.14))}px ${BRAND_FONT}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('LOGO', element.x + element.width / 2, element.y + element.height / 2, element.width * 0.9);
      }
    } else if (element.kind === 'qr') {
      context.fillStyle = element.panelColor;
      context.fillRect(element.x, element.y, element.width, element.height);
      if (options.qr) context.drawImage(options.qr, element.x + element.inset, element.y + element.inset, element.width - 2 * element.inset, element.height - 2 * element.inset);
      else {
        context.strokeStyle = '#475569';
        context.lineWidth = 2;
        context.strokeRect(element.x, element.y, element.width, element.height);
        context.fillStyle = '#475569';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = `600 ${Math.max(10, Math.round(element.width * 0.2))}px ${BRAND_FONT}`;
        context.fillText('QR', element.x + element.width / 2, element.y + element.height / 2);
      }
    }
  }
}
