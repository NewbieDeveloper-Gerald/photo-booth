import type { PagePreset, TemplateDocument, TemplateElement } from './template-document';

/**
 * Editing rules for the template editor. Everything here is pure: it takes a document
 * and returns a new one, which is what makes undo/redo and autosave trivial to test.
 */

/** Drags and resizes land on this grid, so layouts stay tidy and print predictably. */
export const SNAP_GRID_PX = 10;
/** Nothing may be dragged closer than this to an edge, or it disappears in the trim. */
export const MIN_ELEMENT_SIZE_PX = 24;
/** Elements snap to the page centre and edges when within this distance. */
const ALIGN_SNAP_PX = 12;
const MAX_SHOTS = 6;
const TEXT_FONT_RATIO = 0.022;

export function snapToGrid(value: number): number {
  return Math.round(value / SNAP_GRID_PX) * SNAP_GRID_PX;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Pulls a value to the page centre or an edge when it is close, otherwise to the grid. */
export function snapAlongAxis({ value, size, limit }: { value: number; size: number; limit: number }): number {
  const centreOffset = (limit - size) / 2;
  for (const candidate of [0, centreOffset, limit - size]) {
    if (Math.abs(value - candidate) <= ALIGN_SNAP_PX) return Math.round(candidate);
  }
  return clamp(snapToGrid(value), 0, Math.max(0, limit - size));
}

function replaceElement(template: TemplateDocument, elementId: string, update: (element: TemplateElement) => TemplateElement): TemplateDocument {
  if (!template.elements.some((element) => element.id === elementId)) throw new Error(`No element called ${elementId}`);
  return { ...template, elements: template.elements.map((element) => element.id === elementId ? update(element) : element) };
}

export function moveElement(template: TemplateDocument, elementId: string, delta: { dx: number; dy: number }): TemplateDocument {
  return replaceElement(template, elementId, (element) => ({
    ...element,
    x: snapAlongAxis({ value: element.x + delta.dx, size: element.width, limit: template.page.widthPx }),
    y: snapAlongAxis({ value: element.y + delta.dy, size: element.height, limit: template.page.heightPx }),
  }));
}

export function resizeElement(template: TemplateDocument, elementId: string, size: { width: number; height: number }): TemplateDocument {
  return replaceElement(template, elementId, (element) => ({
    ...element,
    width: clamp(snapToGrid(size.width), MIN_ELEMENT_SIZE_PX, template.page.widthPx - element.x),
    height: clamp(snapToGrid(size.height), MIN_ELEMENT_SIZE_PX, template.page.heightPx - element.y),
  }));
}

/** Layer order is what makes bands sit behind text and photos sit under the QR. */
export function moveElementLayer(template: TemplateDocument, elementId: string, direction: 'up' | 'down' | 'front' | 'back'): TemplateDocument {
  const layers = template.elements.map((element) => element.layer);
  const element = template.elements.find((item) => item.id === elementId);
  if (!element) throw new Error(`No element called ${elementId}`);
  const nextLayer = direction === 'front' ? Math.max(...layers) + 1
    : direction === 'back' ? Math.min(...layers) - 1
      : direction === 'up' ? element.layer + 1
        : element.layer - 1;
  return replaceElement(template, elementId, (item) => ({ ...item, layer: nextLayer }));
}

function nextId(template: TemplateDocument, prefix: string): string {
  let index = 1;
  while (template.elements.some((element) => element.id === `${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function topLayer(template: TemplateDocument): number {
  return template.elements.reduce((maximum, element) => Math.max(maximum, element.layer), 0);
}

/** A new text element starts centred and readable on any page size. */
export function addTextElement(template: TemplateDocument, text = 'New text'): { template: TemplateDocument; elementId: string } {
  const elementId = nextId(template, 'text');
  const height = Math.round(template.page.heightPx * 0.05);
  const element: TemplateElement = {
    id: elementId, kind: 'text', layer: topLayer(template) + 1,
    x: 0, y: Math.round(template.page.heightPx / 2 - height / 2),
    width: template.page.widthPx, height,
    text, color: '#111827', fontSize: Math.round(template.page.widthPx * TEXT_FONT_RATIO), fontWeight: 600, align: 'center',
    maxWidth: template.page.widthPx - 2 * template.page.marginPx,
  };
  return { template: { ...template, elements: [...template.elements, element] }, elementId };
}

/** A band or panel: the building block for brand stripes. */
export function addRectElement(template: TemplateDocument): { template: TemplateDocument; elementId: string } {
  const elementId = nextId(template, 'rect');
  const element: TemplateElement = {
    id: elementId, kind: 'rect', layer: 1,
    x: template.page.marginPx, y: Math.round(template.page.heightPx * 0.4),
    width: template.page.widthPx - 2 * template.page.marginPx, height: Math.round(template.page.heightPx * 0.06),
    color: '#c90000',
  };
  return { template: { ...template, elements: [...template.elements, element] }, elementId };
}

/** Adds one more photo slot (max 6) with a box in the lower third, ready to drag. */
export function addPhotoElement(template: TemplateDocument): { template: TemplateDocument; elementId: string } {
  if (template.shots >= MAX_SHOTS) throw new Error(`A layout can hold at most ${MAX_SHOTS} photos`);
  const elementId = nextId(template, 'photo');
  const slotNumber = template.shots + 1;
  const width = Math.round((template.page.widthPx - 2 * template.page.marginPx - SNAP_GRID_PX * 2) / 2);
  const height = Math.round(width * 0.75);
  const element: TemplateElement = {
    id: elementId, kind: 'photo', layer: 3,
    x: template.page.marginPx, y: Math.max(template.page.headerHeightPx, template.page.heightPx - height - template.page.footerHeightPx - SNAP_GRID_PX),
    width, height, slotNumber, frameGutter: 0,
  };
  return { template: { ...template, shots: slotNumber, elements: [...template.elements, element] }, elementId };
}

/** Removes a photo slot and renumbers the rest so validation still passes. */
export function removePhotoElement(template: TemplateDocument, slotNumber: number): TemplateDocument {
  const remaining = template.elements.filter((element) => element.kind !== 'photo' || element.slotNumber !== slotNumber);
  const slots = [...new Set(remaining.filter((element) => element.kind === 'photo').map((element) => element.slotNumber))].sort((a, b) => a - b);
  const renumber = new Map(slots.map((slot, index) => [slot, index + 1]));
  const elements = remaining.map((element) => element.kind === 'photo' ? { ...element, slotNumber: renumber.get(element.slotNumber) ?? element.slotNumber } : element);
  return { ...template, shots: Math.max(1, slots.length), elements };
}

export function addImageElement(template: TemplateDocument, assetName: string): { template: TemplateDocument; elementId: string } {
  const elementId = nextId(template, 'image');
  const element: TemplateElement = {
    id: elementId, kind: 'image', layer: 0, assetName,
    x: 0, y: 0, width: template.page.widthPx, height: template.page.heightPx,
  };
  return { template: { ...template, elements: [...template.elements, element] }, elementId };
}

export function addQrElement(template: TemplateDocument): { template: TemplateDocument; elementId: string } {
  const elementId = nextId(template, 'qr');
  const size = Math.round(template.page.widthPx * 0.09);
  const element: TemplateElement = {
    id: elementId, kind: 'qr', layer: topLayer(template) + 1,
    x: template.page.widthPx - size - template.page.marginPx, y: template.page.marginPx,
    width: size, height: size, inset: 4, panelColor: '#ffffff',
  };
  return { template: { ...template, elements: [...template.elements, element] }, elementId };
}

export function addLogoElement(template: TemplateDocument): { template: TemplateDocument; elementId: string } {
  const elementId = nextId(template, 'logo');
  const size = Math.round(template.page.widthPx * 0.08);
  const element: TemplateElement = {
    id: elementId, kind: 'logo', layer: topLayer(template) + 1,
    x: template.page.marginPx, y: template.page.marginPx, width: size, height: size,
  };
  return { template: { ...template, elements: [...template.elements, element] }, elementId };
}

export function removeElement(template: TemplateDocument, elementId: string): TemplateDocument {
  if (!template.elements.some((element) => element.id === elementId)) throw new Error(`No element called ${elementId}`);
  return { ...template, elements: template.elements.filter((element) => element.id !== elementId) };
}

export type ElementPatch = Partial<Pick<TemplateElement, 'x' | 'y' | 'width' | 'height' | 'layer'>> & {
  text?: string; color?: string; fontSize?: number; fontWeight?: number; align?: 'left' | 'center' | 'right'; maxWidth?: number;
};

/** Applies inspector edits; fields that do not belong to the element kind are dropped. */
export function updateElement(template: TemplateDocument, elementId: string, patch: ElementPatch): TemplateDocument {
  return replaceElement(template, elementId, (element) => {
    const allowed = new Set<string>(['x', 'y', 'width', 'height', 'layer']);
    if (element.kind === 'text') ['text', 'color', 'fontSize', 'fontWeight', 'align', 'maxWidth'].forEach((key) => allowed.add(key));
    if (element.kind === 'rect') allowed.add('color');
    if (element.kind === 'qr') allowed.add('panelColor');
    const applicable = Object.fromEntries(Object.entries(patch).filter(([key, value]) => allowed.has(key) && value !== undefined));
    return { ...element, ...applicable } as TemplateElement;
  });
}

export function renameTemplate(template: TemplateDocument, name: string): TemplateDocument {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the layout a name');
  return { ...template, name: trimmed };
}

export function setBackgroundColor(template: TemplateDocument, color: string): TemplateDocument {
  const background = template.elements.find((element) => element.id === 'background');
  if (background && background.kind === 'rect') return replaceElement(template, 'background', (element) => ({ ...element, color }));
  return { ...template, elements: [{ id: 'background', kind: 'rect', layer: 0, x: 0, y: 0, width: template.page.widthPx, height: template.page.heightPx, color }, ...template.elements] };
}

/** Finds the topmost element under a point, which is what a click should select. */
export function elementAtPoint(template: TemplateDocument, point: { x: number; y: number }): TemplateElement | null {
  const ordered = [...template.elements].sort((a, b) => b.layer - a.layer);
  return ordered.find((element) => point.x >= element.x && point.x <= element.x + element.width && point.y >= element.y && point.y <= element.y + element.height) ?? null;
}

/** Every layout needs a page and at least one slot, so new ones copy the smallest default. */
export function emptyTemplateForPage(page: PagePreset, name: string, id: string): TemplateDocument {
  const document: TemplateDocument = {
    id, name, shots: 1, copies: 1, page,
    elements: [
      { id: 'background', kind: 'rect', layer: 0, x: 0, y: 0, width: page.widthPx, height: page.heightPx, color: '#f4f0ec' },
      { id: 'header-band', kind: 'rect', layer: 1, x: 0, y: 0, width: page.widthPx, height: page.headerHeightPx, color: '#c90000' },
      {
        id: 'header-text', kind: 'text', layer: 5, x: 0, y: 0, width: page.widthPx, height: page.headerHeightPx,
        text: 'RPHOTOSHOOT · {{eventName}}', color: '#ffffff', fontSize: Math.round(page.widthPx * 0.025), fontWeight: 700,
        align: 'center', maxWidth: page.widthPx - 2 * page.marginPx, qrAvoid: true,
      },
      { id: 'footer-band', kind: 'rect', layer: 1, x: 0, y: page.heightPx - page.footerHeightPx, width: page.widthPx, height: page.footerHeightPx, color: '#c90000' },
      {
        id: 'footer-text', kind: 'text', layer: 5, x: 0, y: page.heightPx - page.footerHeightPx, width: page.widthPx, height: page.footerHeightPx,
        text: 'CAPTURING MOMENTS, CREATING MEMORIES', color: '#ffffff', fontSize: Math.round(page.widthPx * 0.015), fontWeight: 500,
        align: 'center', maxWidth: page.widthPx - 2 * page.marginPx,
      },
      {
        id: 'photo-1', kind: 'photo', layer: 3, slotNumber: 1, frameGutter: 0,
        x: page.marginPx, y: page.headerHeightPx + page.marginPx,
        width: page.widthPx - 2 * page.marginPx, height: page.heightPx - page.headerHeightPx - page.footerHeightPx - 2 * page.marginPx,
      },
    ],
  };
  return document;
}
