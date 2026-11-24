import { describe, expect, it } from 'vitest';
import { createGridTemplate, templateFromCatalogPreset } from './template-builder';
import { getPagePreset, isValidTemplateDocument, type TemplateDocument } from './template-document';
import { layoutPresets } from '../catalog';

function gridDocument(): TemplateDocument {
  return createGridTemplate({ pageId: '4x6', shots: 3 });
}

describe('template validation', () => {
  it('accepts every generated template', () => {
    expect(isValidTemplateDocument(gridDocument())).toBe(true);
    for (const preset of layoutPresets) expect(isValidTemplateDocument(templateFromCatalogPreset(preset))).toBe(true);
  });

  it('rejects a photo count outside 1–6', () => {
    expect(isValidTemplateDocument({ ...gridDocument(), shots: 0 })).toMatch(/between 1 and 6/);
    expect(isValidTemplateDocument({ ...gridDocument(), shots: 7 })).toMatch(/between 1 and 6/);
  });

  it('rejects a page that is not 300 dpi', () => {
    const document = gridDocument();
    expect(isValidTemplateDocument({ ...document, page: { ...document.page, dpi: 72 } })).toMatch(/300 dpi/);
  });

  it('rejects an element outside the page', () => {
    const document = gridDocument();
    const elements = document.elements.map((element) => element.id === 'header-band' ? { ...element, width: document.page.widthPx + 1 } : element);
    expect(isValidTemplateDocument({ ...document, elements })).toMatch(/header-band.*outside the page/);
  });

  it('rejects a photo box for a slot the template does not have', () => {
    const document = createGridTemplate({ pageId: '4x6', shots: 2 });
    const elements = document.elements.map((element) => element.kind === 'photo' ? { ...element, slotNumber: 5 } : element);
    expect(isValidTemplateDocument({ ...document, elements })).toMatch(/unknown photo slot/);
  });

  it('reports a missing photo box instead of dropping it at print time', () => {
    const document = createGridTemplate({ pageId: '4x6', shots: 3 });
    const elements = document.elements.filter((element) => element.kind !== 'photo' || element.slotNumber !== 2);
    expect(isValidTemplateDocument({ ...document, elements })).toMatch(/missing a box for photo 2/);
  });

  it('rejects unreadable text and unknown page presets', () => {
    const document = gridDocument();
    const elements = document.elements.map((element) => element.kind === 'text' ? { ...element, fontSize: 2 } : element);
    expect(isValidTemplateDocument({ ...document, elements })).toMatch(/unreadable font size/);
    expect(() => getPagePreset('a9' as never)).toThrow(/Unknown page preset/);
  });
});
