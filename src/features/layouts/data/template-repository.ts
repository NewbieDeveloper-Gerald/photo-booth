import type Database from 'better-sqlite3';
import { withDatabase } from '../../storage/database/connection';
import { layoutPresets } from '../catalog';
import { createGridTemplate, templateFromCatalogPreset } from '../domain/template-builder';
import { getPagePreset, isValidTemplateDocument, type PagePresetId, type TemplateDocument, type TemplateElement } from '../domain/template-document';

export type TemplateSummary = { id: string; name: string; shots: number; copies: number; pagePreset: PagePresetId; pageLabel: string; builtIn: boolean };

type TemplateRow = {
  id: string; name: string; shots: number; copies: number; page_preset: string; page_width_px: number; page_height_px: number;
  dpi: number; margin_px: number; header_height_px: number; footer_height_px: number; is_builtin: number;
};

type ElementRow = {
  element_id: string; position: number; kind: string; layer: number; x: number; y: number; width: number; height: number;
  slot_number: number | null; text: string | null; color: string | null; font_size: number | null; font_weight: number | null;
  align: string | null; max_width: number | null; qr_avoid: number | null; frame_gutter: number | null; inset: number | null; panel_color: string | null;
};

type ElementValues = Omit<ElementRow, 'element_id' | 'position'> & { element_id: string };

/** The three new page sizes ship with grid templates for every supported photo count. */
const NEW_PAGE_SHOT_COUNTS = [1, 2, 3, 4, 5, 6];
const NEW_PAGE_PRESETS: PagePresetId[] = ['2x6-strip', '5x7', 'square'];

export function builtinTemplates(): TemplateDocument[] {
  const catalog = layoutPresets.map((preset) => templateFromCatalogPreset(preset));
  const generated = NEW_PAGE_PRESETS.flatMap((pageId) =>
    NEW_PAGE_SHOT_COUNTS.map((shots) => createGridTemplate({ pageId, shots })));
  return [...catalog, ...generated];
}

function elementToRow(element: TemplateElement): ElementValues {
  return {
    element_id: element.id,
    kind: element.kind,
    layer: element.layer,
    x: element.x, y: element.y, width: element.width, height: element.height,
    slot_number: element.kind === 'photo' ? element.slotNumber : null,
    text: element.kind === 'text' ? element.text : null,
    color: element.kind === 'rect' || element.kind === 'text' ? element.color : null,
    font_size: element.kind === 'text' ? element.fontSize : null,
    font_weight: element.kind === 'text' ? element.fontWeight : null,
    align: element.kind === 'text' ? element.align : null,
    max_width: element.kind === 'text' ? element.maxWidth ?? null : null,
    qr_avoid: element.kind === 'text' && element.qrAvoid ? 1 : null,
    frame_gutter: element.kind === 'photo' ? element.frameGutter : null,
    inset: element.kind === 'qr' ? element.inset : null,
    panel_color: element.kind === 'qr' ? element.panelColor : null,
  };
}

function rowToElement(row: ElementRow): TemplateElement {
  const base = { id: row.element_id, x: row.x, y: row.y, width: row.width, height: row.height, layer: row.layer };
  switch (row.kind) {
    case 'rect':
      return { ...base, kind: 'rect', color: row.color ?? '#000000' };
    case 'text': {
      const text = {
        ...base, kind: 'text' as const, text: row.text ?? '', color: row.color ?? '#ffffff',
        fontSize: row.font_size ?? 12, fontWeight: row.font_weight ?? 400,
        align: (row.align as 'left' | 'center' | 'right' | null) ?? 'center',
      };
      return { ...text, ...(row.max_width === null ? {} : { maxWidth: row.max_width }), ...(row.qr_avoid ? { qrAvoid: true } : {}) };
    }
    case 'photo':
      return { ...base, kind: 'photo', slotNumber: row.slot_number ?? 1, frameGutter: row.frame_gutter ?? 0 };
    case 'logo':
      return { ...base, kind: 'logo' };
    case 'qr':
      return { ...base, kind: 'qr', inset: row.inset ?? 0, panelColor: row.panel_color ?? '#ffffff' };
    default:
      throw new Error(`Unknown template element kind: ${row.kind}`);
  }
}

function writeTemplate(database: Database.Database, document: TemplateDocument): void {
  const invalid = isValidTemplateDocument(document);
  if (invalid !== true) throw new Error(`Template ${document.id}: ${invalid}`);
  database.prepare(`INSERT OR REPLACE INTO templates
    (id, name, shots, copies, page_preset, page_width_px, page_height_px, dpi, margin_px, header_height_px, footer_height_px, is_builtin)
    VALUES (@id, @name, @shots, @copies, @pagePreset, @width, @height, @dpi, @margin, @header, @footer, 1)`).run({
    id: document.id, name: document.name, shots: document.shots, copies: document.copies,
    pagePreset: document.page.id, width: document.page.widthPx, height: document.page.heightPx,
    dpi: document.page.dpi, margin: document.page.marginPx, header: document.page.headerHeightPx, footer: document.page.footerHeightPx,
  });
  database.prepare('DELETE FROM template_elements WHERE template_id = ?').run(document.id);
  const insertElement = database.prepare(`INSERT INTO template_elements
    (template_id, element_id, position, kind, layer, x, y, width, height, slot_number, text, color, font_size, font_weight, align, max_width, qr_avoid, frame_gutter, inset, panel_color)
    VALUES (@templateId, @element_id, @position, @kind, @layer, @x, @y, @width, @height, @slot_number, @text, @color, @font_size, @font_weight, @align, @max_width, @qr_avoid, @frame_gutter, @inset, @panel_color)`);
  document.elements.forEach((element, position) => {
    insertElement.run({ templateId: document.id, position, ...elementToRow(element) });
  });
}

/** Inserts any missing built-in template; safe to call before every read. */
export function ensureBuiltinTemplates(userDataPath: string): void {
  withDatabase(userDataPath, (database) => {
    const existing = new Set(database.prepare('SELECT id FROM templates').all().map((row) => (row as { id: string }).id));
    const missing = builtinTemplates().filter((document) => !existing.has(document.id));
    if (missing.length === 0) return;
    database.transaction(() => { for (const document of missing) writeTemplate(database, document); })();
  });
}

export function listTemplates(userDataPath: string): TemplateSummary[] {
  ensureBuiltinTemplates(userDataPath);
  return withDatabase(userDataPath, (database) => database
    .prepare('SELECT id, name, shots, copies, page_preset, is_builtin FROM templates ORDER BY page_preset, shots, name')
    .all()
    .map((row) => {
      const template = row as TemplateRow;
      return {
        id: template.id, name: template.name, shots: template.shots, copies: template.copies,
        pagePreset: template.page_preset as PagePresetId, pageLabel: getPagePreset(template.page_preset as PagePresetId).label,
        builtIn: template.is_builtin === 1,
      };
    }));
}

export function loadTemplate(userDataPath: string, templateId: string): TemplateDocument {
  ensureBuiltinTemplates(userDataPath);
  return withDatabase(userDataPath, (database) => {
    const row = database.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) as TemplateRow | undefined;
    if (!row) throw new Error('That layout does not exist on this booth.');
    const elements = database.prepare('SELECT * FROM template_elements WHERE template_id = ? ORDER BY position').all(templateId) as ElementRow[];
    const document: TemplateDocument = {
      id: row.id,
      name: row.name,
      shots: row.shots,
      copies: row.copies,
      page: {
        id: row.page_preset as PagePresetId,
        label: getPagePreset(row.page_preset as PagePresetId).label,
        widthPx: row.page_width_px,
        heightPx: row.page_height_px,
        dpi: row.dpi,
        marginPx: row.margin_px,
        headerHeightPx: row.header_height_px,
        footerHeightPx: row.footer_height_px,
      },
      elements: elements.map(rowToElement),
    };
    const invalid = isValidTemplateDocument(document);
    if (invalid !== true) throw new Error(`Stored layout ${templateId} is invalid: ${invalid}`);
    return document;
  });
}

/** Saves an edited template; F12's editor will call this, and seeding uses it too. */
export function saveTemplate(userDataPath: string, document: TemplateDocument): void {
  withDatabase(userDataPath, (database) => { database.transaction(() => writeTemplate(database, document))(); });
}
