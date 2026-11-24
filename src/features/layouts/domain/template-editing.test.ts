import { describe, expect, it } from 'vitest';
import { layoutPresets } from '../catalog';
import { getPagePreset, isValidTemplateDocument } from './template-document';
import { templateFromCatalogPreset } from './template-builder';
import {
  SNAP_GRID_PX, addImageElement, addLogoElement, addPhotoElement, addQrElement, addRectElement, addTextElement,
  elementAtPoint, emptyTemplateForPage, moveElement, moveElementLayer, removeElement, removePhotoElement,
  renameTemplate, resizeElement, setBackgroundColor, snapAlongAxis, snapToGrid, updateElement,
} from './template-editing';

const base = (): ReturnType<typeof templateFromCatalogPreset> => templateFromCatalogPreset(layoutPresets[0]!);
const photo = (template: ReturnType<typeof base>) => template.elements.find((element) => element.kind === 'photo')!;

describe('snapping', () => {
  it('rounds to the grid', () => {
    expect(snapToGrid(4)).toBe(0);
    expect(snapToGrid(6)).toBe(10);
    expect(snapToGrid(-13)).toBe(-10);
    expect(SNAP_GRID_PX).toBe(10);
  });

  it('pulls to centre and edges when close, otherwise to the grid', () => {
    expect(snapAlongAxis({ value: 5, size: 100, limit: 1200 })).toBe(0);
    expect(snapAlongAxis({ value: 548, size: 100, limit: 1200 })).toBe(550);
    expect(snapAlongAxis({ value: 1096, size: 100, limit: 1200 })).toBe(1100);
    expect(snapAlongAxis({ value: 304, size: 100, limit: 1200 })).toBe(300);
  });

  it('never lets an element leave the page', () => {
    expect(snapAlongAxis({ value: -50, size: 100, limit: 1200 })).toBe(0);
    expect(snapAlongAxis({ value: 1190, size: 100, limit: 1200 })).toBe(1100);
  });
});

describe('moving and resizing', () => {
  it('moves on the grid and stays inside the page', () => {
    const moved = moveElement(base(), photo(base()).id, { dx: 33, dy: -500 });
    const element = photo(moved);
    expect(element.x % SNAP_GRID_PX).toBe(0);
    expect(element.y).toBeGreaterThanOrEqual(0);
  });

  it('resizes with a minimum size and a page limit', () => {
    const id = photo(base()).id;
    expect(photo(resizeElement(base(), id, { width: 5, height: 5 }))).toMatchObject({ width: 24, height: 24 });
    const huge = photo(resizeElement(base(), id, { width: 9999, height: 9999 }));
    expect(huge.x + huge.width).toBeLessThanOrEqual(1200);
    expect(huge.y + huge.height).toBeLessThanOrEqual(1800);
  });

  it('rejects an unknown element instead of silently doing nothing', () => {
    expect(() => moveElement(base(), 'nope', { dx: 1, dy: 1 })).toThrow(/No element called nope/);
    expect(() => removeElement(base(), 'nope')).toThrow(/No element called nope/);
  });
});

describe('layers', () => {
  it('brings an element to the front and pushes it to the back', () => {
    const id = 'header-text';
    const front = moveElementLayer(base(), id, 'front');
    expect(front.elements.find((element) => element.id === id)!.layer).toBeGreaterThan(Math.max(...base().elements.filter((element) => element.id !== id).map((element) => element.layer)));
    const back = moveElementLayer(base(), id, 'back');
    expect(back.elements.find((element) => element.id === id)!.layer).toBeLessThan(Math.min(...base().elements.filter((element) => element.id !== id).map((element) => element.layer)));
  });

  it('steps one layer at a time', () => {
    const before = base().elements.find((element) => element.id === 'header-text')!.layer;
    expect(moveElementLayer(base(), 'header-text', 'up').elements.find((element) => element.id === 'header-text')!.layer).toBe(before + 1);
    expect(moveElementLayer(base(), 'header-text', 'down').elements.find((element) => element.id === 'header-text')!.layer).toBe(before - 1);
  });
});

describe('adding elements', () => {
  it('adds text, a band, a photo slot, an image, a logo and a QR and stays valid', () => {
    let template = base();
    template = addTextElement(template, 'Hello').template;
    template = addRectElement(template).template;
    template = addImageElement(template, 'artwork.png').template;
    template = addLogoElement(template).template;
    template = addQrElement(template).template;
    expect(isValidTemplateDocument(template)).toBe(true);
    expect(template.elements.filter((element) => element.kind === 'text')).toHaveLength(3);
    expect(template.elements.filter((element) => element.kind === 'image')).toHaveLength(1);
  });

  it('numbers new elements without colliding', () => {
    const first = addTextElement(base());
    const second = addTextElement(first.template);
    expect(second.elementId).not.toBe(first.elementId);
  });

  it('adds photo slots up to six and refuses the seventh', () => {
    let template = emptyTemplateForPage(getPagePreset('4x6'), 'Blank', 'blank');
    for (let shots = 2; shots <= 6; shots += 1) {
      template = addPhotoElement(template).template;
      expect(template.shots).toBe(shots);
      expect(isValidTemplateDocument(template)).toBe(true);
    }
    expect(() => addPhotoElement(template)).toThrow(/at most 6 photos/);
  });

  it('renumbers the remaining photos when a slot is removed', () => {
    let template = emptyTemplateForPage(getPagePreset('4x6'), 'Blank', 'blank');
    template = addPhotoElement(template).template;
    template = addPhotoElement(template).template;
    const withoutMiddle = removePhotoElement(template, 2);
    expect(withoutMiddle.shots).toBe(2);
    expect(withoutMiddle.elements.filter((element) => element.kind === 'photo').map((element) => element.slotNumber).sort()).toEqual([1, 2]);
    expect(isValidTemplateDocument(withoutMiddle)).toBe(true);
  });
});

describe('inspector edits', () => {
  it('edits text fields and ignores fields the element kind does not have', () => {
    const updated = updateElement(base(), 'header-text', { text: 'Hello', fontSize: 44, color: '#00ff00', layer: 9, slotNumber: 3 } as never);
    expect(updated.elements.find((element) => element.id === 'header-text')).toMatchObject({ text: 'Hello', fontSize: 44, color: '#00ff00', layer: 9 });
    expect((updated.elements.find((element) => element.id === 'header-text') as { slotNumber?: number }).slotNumber).toBeUndefined();
  });

  it('renames a layout and rejects an empty name', () => {
    expect(renameTemplate(base(), '  Wedding strip  ').name).toBe('Wedding strip');
    expect(() => renameTemplate(base(), '   ')).toThrow(/Give the layout a name/);
  });

  it('replaces or adds the background colour', () => {
    const recoloured = setBackgroundColor(base(), '#000000');
    expect(recoloured.elements.find((element) => element.id === 'background')).toMatchObject({ color: '#000000' });
    const blank = { ...emptyTemplateForPage(getPagePreset('4x6'), 'Blank', 'blank') };
    const withoutBackground = { ...blank, elements: blank.elements.filter((element) => element.id !== 'background') };
    expect(setBackgroundColor(withoutBackground, '#123456').elements[0]).toMatchObject({ id: 'background', layer: 0, color: '#123456' });
  });
});

describe('hit testing', () => {
  it('selects the topmost element under the pointer', () => {
    expect(elementAtPoint(base(), { x: 100, y: 20 })?.id).toBe('logo');
    expect(elementAtPoint(base(), { x: 600, y: 20 })?.id).toBe('header-text');
    expect(elementAtPoint(base(), { x: 100, y: 200 })?.kind).toBe('photo');
    expect(elementAtPoint(base(), { x: -5, y: -5 })).toBeNull();
  });
});
