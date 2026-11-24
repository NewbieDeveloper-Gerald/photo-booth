/**
 * A template is data: a page plus a list of elements, each with a position, a size
 * and a layer. The renderer paints them in layer order and never reads the catalog.
 */

export type PagePresetId = '4x6' | '2x6-strip' | '5x7' | 'square';

export type PagePreset = {
  id: PagePresetId;
  label: string;
  /** Page size in template pixels (300 dpi), i.e. the printed size. */
  widthPx: number;
  heightPx: number;
  dpi: number;
  /** Print-safe margin: no element may sit closer to the edge than this. */
  marginPx: number;
  headerHeightPx: number;
  footerHeightPx: number;
};

export const pagePresets: PagePreset[] = [
  { id: '4x6', label: '4 × 6 in', widthPx: 1200, heightPx: 1800, dpi: 300, marginPx: 40, headerHeightPx: 112, footerHeightPx: 62 },
  { id: '2x6-strip', label: '2 × 6 in strip', widthPx: 600, heightPx: 1800, dpi: 300, marginPx: 24, headerHeightPx: 96, footerHeightPx: 56 },
  { id: '5x7', label: '5 × 7 in', widthPx: 1500, heightPx: 2100, dpi: 300, marginPx: 48, headerHeightPx: 128, footerHeightPx: 72 },
  { id: 'square', label: 'Square 6 × 6 in', widthPx: 1800, heightPx: 1800, dpi: 300, marginPx: 48, headerHeightPx: 120, footerHeightPx: 68 },
];

export function getPagePreset(id: PagePresetId): PagePreset {
  const preset = pagePresets.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown page preset: ${id}`);
  return preset;
}

type BaseElement = { id: string; x: number; y: number; width: number; height: number; layer: number };

/** Solid rectangle: the brand bands behind the header and footer text. */
export type RectElement = BaseElement & { kind: 'rect'; color: string };

/** `qrAvoid` narrows the box when a guest QR is drawn in the header, so text never sits under it. */
export type TextElement = BaseElement & {
  kind: 'text';
  text: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  align: 'left' | 'center' | 'right';
  maxWidth?: number;
  qrAvoid?: boolean;
};

/** One photo slot; `frameGutter` is the white border drawn around it. */
export type PhotoElement = BaseElement & { kind: 'photo'; slotNumber: number; frameGutter: number };

export type LogoElement = BaseElement & { kind: 'logo' };

/** Guest download QR: a white panel with the code inset inside it. */
export type QrElement = BaseElement & { kind: 'qr'; inset: number; panelColor: string };

export type TemplateElement = RectElement | TextElement | PhotoElement | LogoElement | QrElement;

export type TemplateDocument = {
  id: string;
  name: string;
  shots: number;
  copies: number;
  page: PagePreset;
  elements: TemplateElement[];
};

const MAX_SHOTS = 6;
const MIN_SHOTS = 1;
const MIN_FONT_SIZE = 6;

/** Validates a template before it is stored or rendered; message names the offending field. */
export function isValidTemplateDocument(document: TemplateDocument): true | string {
  if (!document.id || !document.name) return 'Template needs an id and a name';
  if (!Number.isInteger(document.shots) || document.shots < MIN_SHOTS || document.shots > MAX_SHOTS) {
    return `Template photo count must be between ${MIN_SHOTS} and ${MAX_SHOTS}`;
  }
  if (!Number.isInteger(document.copies) || document.copies < 1) return 'Template copies must be at least 1';
  if (document.page.dpi !== 300) return 'Template pages must be 300 dpi';
  const slots = new Set<number>();
  for (const element of document.elements) {
    const inside = element.x >= 0 && element.y >= 0 && element.width > 0 && element.height > 0
      && element.x + element.width <= document.page.widthPx && element.y + element.height <= document.page.heightPx;
    if (!inside) return `Element ${element.id} is outside the page`;
    if (element.kind === 'text' && element.fontSize < MIN_FONT_SIZE) return `Element ${element.id} has an unreadable font size`;
    if (element.kind === 'photo') {
      if (element.slotNumber < 1 || element.slotNumber > document.shots) return `Element ${element.id} references an unknown photo slot`;
      slots.add(element.slotNumber);
    }
  }
  for (let slot = 1; slot <= document.shots; slot += 1) {
    if (!slots.has(slot)) return `Template is missing a box for photo ${slot}`;
  }
  return true;
}
