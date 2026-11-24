import { describe, expect, it } from 'vitest';
import { layoutPresets } from '../catalog';
import { templateFromCatalogPreset, createGridTemplate } from './template-builder';
import { computeTextPlacement, paintOrder, resolveText } from './template-paint-plan';
import type { TemplateDocument, TemplateElement, TextElement } from './template-document';

function textOf(document: TemplateDocument, id: string): TextElement {
  const found = document.elements.find((element) => element.id === id);
  if (!found || found.kind !== 'text') throw new Error(`missing text ${id}`);
  return found;
}

const catalogDocument = (): TemplateDocument => templateFromCatalogPreset(layoutPresets[0]!);

describe('Phase 1 parity', () => {
  it('centres the header text on the full page when no QR is drawn', () => {
    const placement = computeTextPlacement(textOf(catalogDocument(), 'header-text'), { eventName: 'Ann & Ben', drawQr: false });
    expect(placement).toMatchObject({ x: 600, y: 56, maxWidth: 1120, fontSize: 30, fontWeight: 700, align: 'center', color: '#ffffff' });
  });

  it('shifts the header text left by half the QR reserve when a QR is drawn', () => {
    const placement = computeTextPlacement(textOf(catalogDocument(), 'header-text'), { eventName: 'Ann & Ben', drawQr: true });
    expect(placement.x).toBe(536);
    expect(placement.maxWidth).toBe(1040);
  });

  it('centres the footer text with the Phase 1 wrap width', () => {
    const placement = computeTextPlacement(textOf(catalogDocument(), 'footer-text'), { eventName: 'Ann & Ben', drawQr: true });
    expect(placement).toMatchObject({ x: 600, y: 1800 - 31, maxWidth: 1140, fontSize: 18, fontWeight: 500 });
  });
});

describe('text resolution', () => {
  it('substitutes the event name placeholder', () => {
    expect(resolveText(textOf(catalogDocument(), 'header-text'), { eventName: 'Ann & Ben', drawQr: false })).toBe('RPHOTOSHOOT · Ann & Ben');
  });

  it('lets the event thank-you wording replace the footer line', () => {
    const footer = textOf(catalogDocument(), 'footer-text');
    expect(resolveText(footer, { eventName: 'X', thankYouText: 'Thanks for coming!', drawQr: false })).toBe('Thanks for coming!');
    expect(resolveText(footer, { eventName: 'X', thankYouText: null, drawQr: false })).toBe(footer.text);
  });

  it('supports both placeholders in any text element', () => {
    const custom: TextElement = { id: 'note', kind: 'text', layer: 5, x: 0, y: 0, width: 100, height: 40, text: '{{eventName}} — {{thankYouText}}', color: '#000000', fontSize: 12, fontWeight: 400, align: 'center' };
    expect(resolveText(custom, { eventName: 'Wedding', thankYouText: 'Thanks', drawQr: false })).toBe('Wedding — Thanks');
  });
});

describe('alignment', () => {
  const element: TextElement = { id: 'left', kind: 'text', layer: 5, x: 100, y: 200, width: 300, height: 60, text: 'A', color: '#000000', fontSize: 20, fontWeight: 400, align: 'left', maxWidth: 280 };
  it('anchors left text at the box origin and right text at the box end', () => {
    expect(computeTextPlacement(element, { eventName: '', drawQr: false })).toMatchObject({ x: 100, y: 230, maxWidth: 280 });
    expect(computeTextPlacement({ ...element, align: 'right' }, { eventName: '', drawQr: false })).toMatchObject({ x: 400 });
  });
});

describe('paint order', () => {
  it('paints background, bands, photos, then text, logo and QR', () => {
    const order = paintOrder(catalogDocument()).map((element) => element.kind);
    expect(order[0]).toBe('rect');
    expect(order.indexOf('photo')).toBeGreaterThan(order.lastIndexOf('rect'));
    expect(order.indexOf('text')).toBeGreaterThan(order.indexOf('photo'));
    expect(order.indexOf('logo')).toBeGreaterThan(order.indexOf('text'));
    expect(order.indexOf('qr')).toBeGreaterThan(order.indexOf('logo'));
  });

  it('is stable for equal layers', () => {
    const document: TemplateDocument = {
      ...createGridTemplate({ pageId: '4x6', shots: 1 }),
      elements: [
        { id: 'b', kind: 'rect', layer: 1, x: 0, y: 0, width: 10, height: 10, color: '#000000' },
        { id: 'a', kind: 'rect', layer: 1, x: 0, y: 0, width: 10, height: 10, color: '#111111' },
      ] as TemplateElement[],
    };
    expect(paintOrder(document).map((element) => element.id)).toEqual(['b', 'a']);
  });
});
