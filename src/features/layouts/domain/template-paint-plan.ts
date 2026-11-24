import { QR_AVOID_RESERVE_PX, QR_AVOID_TEXT_RESERVE_PX } from './template-builder';
import type { TemplateDocument, TemplateElement, TextElement } from './template-document';

export type PaintContext = { eventName: string; thankYouText?: string | null; drawQr: boolean };
export type TextPlacement = { text: string; x: number; y: number; maxWidth: number; fontSize: number; fontWeight: number; align: CanvasTextAlign; color: string };

/** Substitutes the two placeholders a template may use, and the event's thank-you wording. */
export function resolveText(element: TextElement, context: PaintContext): string {
  const base = element.id === 'footer-text' && context.thankYouText ? context.thankYouText : element.text;
  return base.replaceAll('{{eventName}}', context.eventName).replaceAll('{{thankYouText}}', context.thankYouText ?? '');
}

/**
 * Text is drawn centred on its box (horizontally per `align`). A `qrAvoid` element
 * shrinks when the guest QR is actually painted, so the two never overlap — this is
 * the Phase 1 behaviour, expressed as data on the element instead of renderer branches.
 */
export function computeTextPlacement(element: TextElement, context: PaintContext): TextPlacement {
  const shrink = element.qrAvoid && context.drawQr;
  const width = element.width - (shrink ? QR_AVOID_RESERVE_PX : 0);
  const maxWidth = Math.max(0, (element.maxWidth ?? element.width) - (shrink ? QR_AVOID_TEXT_RESERVE_PX : 0));
  const x = element.align === 'left' ? element.x : element.align === 'right' ? element.x + width : element.x + width / 2;
  return {
    text: resolveText(element, context),
    x,
    y: element.y + element.height / 2,
    maxWidth,
    fontSize: element.fontSize,
    fontWeight: element.fontWeight,
    align: element.align,
    color: element.color,
  };
}

/** Elements are painted back to front: page, bands, photos, text, logo, guest QR. */
export function paintOrder(template: TemplateDocument): TemplateElement[] {
  return [...template.elements].sort((a, b) => a.layer - b.layer);
}
