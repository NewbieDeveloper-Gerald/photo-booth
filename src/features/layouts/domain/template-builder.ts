import type { LayoutPreset } from '../catalog';
import type { PagePreset, PagePresetId, TemplateDocument, TemplateElement } from './template-document';
import { getPagePreset, pagePresets } from './template-document';

/** Brand font sizes scale with the page width: 30/18 px on a 4 × 6 in page. */
const HEADER_FONT_RATIO = 0.025;
const FOOTER_FONT_RATIO = 0.015;
/** Gap between photo columns in the Phase 1 strip layouts. */
const STRIP_COLUMN_GAP = 52;
/**
 * When a guest QR is drawn, the header text box narrows by this much and its wrap
 * width by QR_AVOID_TEXT_RESERVE_PX — the Phase 1 numbers, kept so prints do not move.
 */
export const QR_AVOID_RESERVE_PX = 128;
export const QR_AVOID_TEXT_RESERVE_PX = 80;
/** Space between the photo grid and the header/footer bands on template-driven pages. */
const GRID_GAP = 24;
const LOGO_BOX = 88;
const LOGO_MARGIN = 12;
const QR_PANEL_SIZE = 104;
const QR_PANEL_MARGIN = 8;
const QR_INSET = 4;

function bandElements(page: PagePreset, background: string, accent: string): TemplateElement[] {
  const headerFont = Math.round(page.widthPx * HEADER_FONT_RATIO);
  const footerFont = Math.round(page.widthPx * FOOTER_FONT_RATIO);
  return [
    { id: 'background', kind: 'rect', layer: 0, x: 0, y: 0, width: page.widthPx, height: page.heightPx, color: background },
    { id: 'header-band', kind: 'rect', layer: 1, x: 0, y: 0, width: page.widthPx, height: page.headerHeightPx, color: accent },
    {
      id: 'header-text', kind: 'text', layer: 5, x: 0, y: 0, width: page.widthPx, height: page.headerHeightPx,
      text: '', color: '#ffffff', fontSize: headerFont, fontWeight: 700, align: 'center', qrAvoid: true,
    },
    { id: 'logo', kind: 'logo', layer: 6, x: LOGO_MARGIN, y: LOGO_MARGIN, width: LOGO_BOX, height: LOGO_BOX },
    {
      id: 'qr', kind: 'qr', layer: 7,
      x: page.widthPx - QR_PANEL_SIZE - QR_PANEL_MARGIN, y: QR_PANEL_MARGIN,
      width: QR_PANEL_SIZE, height: QR_PANEL_SIZE, inset: QR_INSET, panelColor: '#ffffff',
    },
    { id: 'footer-band', kind: 'rect', layer: 1, x: 0, y: page.heightPx - page.footerHeightPx, width: page.widthPx, height: page.footerHeightPx, color: accent },
    {
      id: 'footer-text', kind: 'text', layer: 5, x: 0, y: page.heightPx - page.footerHeightPx,
      width: page.widthPx, height: page.footerHeightPx,
      text: '', color: '#ffffff', fontSize: footerFont, fontWeight: 500, align: 'center',
      maxWidth: page.widthPx - 2 * page.marginPx,
    },
  ];
}

/**
 * Turns one of the six Phase 1 catalog layouts into a document. Geometry is copied
 * verbatim so the printed result is unchanged; this is the migration's safety net.
 */
export function templateFromCatalogPreset(preset: LayoutPreset): TemplateDocument {
  const page: PagePreset = {
    ...pagePresets[0]!,
    widthPx: preset.width,
    heightPx: preset.height,
  };
  const elements: TemplateElement[] = bandElements(page, preset.background, preset.frameColor);
  const headerText = elements.find((element) => element.id === 'header-text') as Extract<TemplateElement, { kind: 'text' }>;
  headerText.text = preset.header.text;
  headerText.fontSize = preset.header.fontSize;
  // Phase 1 wrapped the header at width-80 and the footer at width-60; keep both numbers.
  headerText.maxWidth = preset.width - 80;
  const footerText = elements.find((element) => element.id === 'footer-text') as Extract<TemplateElement, { kind: 'text' }>;
  footerText.text = preset.footer.text;
  footerText.fontSize = preset.footer.fontSize;
  footerText.color = preset.footer.color;
  footerText.maxWidth = preset.width - 60;
  const photos: TemplateElement[] = preset.placements.map((placement, index) => ({
    id: `photo-${index + 1}`, kind: 'photo', layer: 3,
    x: placement.x, y: placement.y, width: placement.width, height: placement.height,
    slotNumber: placement.slot, frameGutter: preset.gutter,
  }));
  return {
    id: preset.id,
    name: preset.name,
    shots: preset.shots,
    copies: preset.copies,
    page,
    elements: [...elements, ...photos],
  };
}

/**
 * Lays `shots` photos out in a grid with `copies` columns (a strip is one column per
 * copy), inside the printable area between the header and footer bands.
 */
export function buildPhotoGrid({ page, shots, copies, gap = GRID_GAP }: { page: PagePreset; shots: number; copies: number; gap?: number }): TemplateElement[] {
  const top = page.headerHeightPx + gap;
  const bottom = page.heightPx - page.footerHeightPx - gap;
  const printableWidth = page.widthPx - 2 * page.marginPx;
  const cellWidth = Math.floor((printableWidth - gap * (copies - 1)) / copies);
  const cellHeight = Math.floor((bottom - top - gap * (shots - 1)) / shots);
  const elements: TemplateElement[] = [];
  for (let copy = 0; copy < copies; copy += 1) {
    for (let row = 0; row < shots; row += 1) {
      elements.push({
        id: `photo-${copy * shots + row + 1}`, kind: 'photo', layer: 3,
        x: page.marginPx + copy * (cellWidth + gap),
        y: top + row * (cellHeight + gap),
        width: cellWidth, height: cellHeight,
        slotNumber: row + 1, frameGutter: 0,
      });
    }
  }
  return elements;
}

/** Builds a template for any page preset and 1–6 photos; used to seed new sizes. */
export function createGridTemplate({ pageId, shots, copies = 1 }: { pageId: PagePresetId; shots: number; copies?: number }): TemplateDocument {
  const page = getPagePreset(pageId);
  const elements = bandElements(page, '#f4f0ec', '#c90000');
  const headerText = elements.find((element) => element.id === 'header-text') as Extract<TemplateElement, { kind: 'text' }>;
  headerText.text = 'RPHOTOSHOOT · {{eventName}}';
  const footerText = elements.find((element) => element.id === 'footer-text') as Extract<TemplateElement, { kind: 'text' }>;
  footerText.text = 'CAPTURING MOMENTS, CREATING MEMORIES';
  const stripWord = copies > 1 ? ` · ${copies} strips` : '';
  return {
    id: `${pageId}-${shots}x${copies}`,
    name: `${page.label} · ${shots} photo${shots === 1 ? '' : 's'}${stripWord}`,
    shots,
    copies,
    page,
    elements: [...elements, ...buildPhotoGrid({ page, shots, copies, gap: copies > 1 ? STRIP_COLUMN_GAP : GRID_GAP })],
  };
}
