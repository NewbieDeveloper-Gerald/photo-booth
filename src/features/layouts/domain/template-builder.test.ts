import { describe, expect, it } from 'vitest';
import { layoutPresets, type LayoutPreset } from '../catalog';
import { buildPhotoGrid, createGridTemplate, templateFromCatalogPreset, QR_AVOID_RESERVE_PX, QR_AVOID_TEXT_RESERVE_PX } from './template-builder';
import { getPagePreset, isValidTemplateDocument, pagePresets, type PhotoElement, type TextElement, type TemplateDocument } from './template-document';

function textElement(document: TemplateDocument, id: string): TextElement {
  const found = document.elements.find((element) => element.id === id);
  if (!found || found.kind !== 'text') throw new Error(`missing text element ${id}`);
  return found;
}

describe('page presets', () => {
  it('covers the four sizes F11 requires, all at 300 dpi', () => {
    expect(pagePresets.map((preset) => preset.id)).toEqual(['4x6', '2x6-strip', '5x7', 'square']);
    for (const preset of pagePresets) {
      expect(preset.dpi).toBe(300);
      expect(preset.widthPx % 300).toBe(0);
      expect(preset.heightPx % 300).toBe(0);
    }
  });

  it('maps each preset onto its printed size in inches', () => {
    const inches = (pixels: number, dpi: number): number => pixels / dpi;
    expect([inches(getPagePreset('4x6').widthPx, 300), inches(getPagePreset('4x6').heightPx, 300)]).toEqual([4, 6]);
    expect([inches(getPagePreset('2x6-strip').widthPx, 300), inches(getPagePreset('2x6-strip').heightPx, 300)]).toEqual([2, 6]);
    expect([inches(getPagePreset('5x7').widthPx, 300), inches(getPagePreset('5x7').heightPx, 300)]).toEqual([5, 7]);
    expect(inches(getPagePreset('square').widthPx, 300)).toBe(6);
  });

  it('leaves a print-safe margin smaller than the bands on every page', () => {
    for (const preset of pagePresets) {
      expect(preset.marginPx).toBeGreaterThan(0);
      expect(preset.marginPx).toBeLessThan(preset.headerHeightPx);
      expect(preset.marginPx).toBeLessThan(preset.footerHeightPx);
    }
  });
});

describe('migrating the Phase 1 catalog', () => {
  it.each(layoutPresets.map((preset) => [preset.id, preset] as const))('%s keeps its exact geometry', (_id, preset: LayoutPreset) => {
    const document = templateFromCatalogPreset(preset);
    const photos = document.elements.filter((element): element is PhotoElement => element.kind === 'photo');
    expect(photos.map(({ x, y, width, height, slotNumber, frameGutter }) => ({ x, y, width, height, slotNumber, frameGutter })))
      .toEqual(preset.placements.map(({ slot, x, y, width, height }) => ({ x, y, width, height, slotNumber: slot, frameGutter: preset.gutter })));
    expect([document.page.widthPx, document.page.heightPx]).toEqual([preset.width, preset.height]);
    expect(document.shots).toBe(preset.shots);
    expect(document.copies).toBe(preset.copies);
    expect(textElement(document, 'header-text').fontSize).toBe(preset.header.fontSize);
    expect(textElement(document, 'footer-text').fontSize).toBe(preset.footer.fontSize);
    expect(textElement(document, 'footer-text').color).toBe(preset.footer.color);
    expect(isValidTemplateDocument(document)).toBe(true);
  });

  it('keeps the Phase 1 band heights and brand colours', () => {
    const document = templateFromCatalogPreset(layoutPresets[0]!);
    const headerBand = document.elements.find((element) => element.id === 'header-band');
    const footerBand = document.elements.find((element) => element.id === 'footer-band');
    expect(headerBand).toMatchObject({ kind: 'rect', y: 0, height: 112, color: '#c90000' });
    expect(footerBand).toMatchObject({ kind: 'rect', y: document.page.heightPx - 62, height: 62 });
    expect(document.elements.find((element) => element.id === 'background')).toMatchObject({ width: 1200, height: 1800, color: '#f4f0ec' });
  });

  it('keeps the QR panel and the header text reserve the renderer relies on', () => {
    const document = templateFromCatalogPreset(layoutPresets[0]!);
    const qr = document.elements.find((element) => element.id === 'qr');
    expect(qr).toMatchObject({ kind: 'qr', x: 1200 - 112, y: 8, width: 104, height: 104, inset: 4 });
    const header = textElement(document, 'header-text');
    expect(header.qrAvoid).toBe(true);
    expect(header.maxWidth).toBe(1200 - 80);
    expect(QR_AVOID_RESERVE_PX).toBe(128);
    expect(QR_AVOID_TEXT_RESERVE_PX).toBe(80);
    expect(header.maxWidth! - QR_AVOID_TEXT_RESERVE_PX).toBe(1200 - 160);
  });
});

describe('grid templates for the new page presets', () => {
  it.each(pagePresets.map((preset) => [preset.id, preset] as const))('%s builds valid documents for 1 to 6 photos', (_id, page) => {
    for (let shots = 1; shots <= 6; shots += 1) {
      const document = createGridTemplate({ pageId: page.id, shots });
      expect(isValidTemplateDocument(document)).toBe(true);
      expect(document.shots).toBe(shots);
      expect(document.page.id).toBe(page.id);
    }
  });

  it('keeps photos inside the printable area and clear of the bands', () => {
    for (const page of pagePresets) {
      for (let shots = 1; shots <= 6; shots += 1) {
        const photos = buildPhotoGrid({ page, shots, copies: 1 });
        expect(photos).toHaveLength(shots);
        for (const photo of photos) {
          expect(photo.x).toBeGreaterThanOrEqual(page.marginPx);
          expect(photo.x + photo.width).toBeLessThanOrEqual(page.widthPx - page.marginPx);
          expect(photo.y).toBeGreaterThanOrEqual(page.headerHeightPx);
          expect(photo.y + photo.height).toBeLessThanOrEqual(page.heightPx - page.footerHeightPx);
        }
      }
    }
  });

  it('never overlaps two photo boxes', () => {
    for (const page of pagePresets) {
      for (let shots = 1; shots <= 6; shots += 1) {
        const photos = buildPhotoGrid({ page, shots, copies: 1 });
        for (let first = 0; first < photos.length; first += 1) {
          for (let second = first + 1; second < photos.length; second += 1) {
            const a = photos[first]!;
            const b = photos[second]!;
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            expect(overlap).toBe(false);
          }
        }
      }
    }
  });

  it('renders one column per copy for strip layouts', () => {
    const page = getPagePreset('2x6-strip');
    const photos = buildPhotoGrid({ page, shots: 4, copies: 2 }) as PhotoElement[];
    expect(photos).toHaveLength(8);
    expect(new Set(photos.map((photo) => photo.x)).size).toBe(2);
    expect(photos.map((photo) => photo.slotNumber)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it('names templates by page and shot count', () => {
    expect(createGridTemplate({ pageId: '5x7', shots: 3 }).name).toBe('5 × 7 in · 3 photos');
    expect(createGridTemplate({ pageId: '2x6-strip', shots: 2, copies: 2 }).name).toBe('2 × 6 in strip · 2 photos · 2 strips');
  });
});
