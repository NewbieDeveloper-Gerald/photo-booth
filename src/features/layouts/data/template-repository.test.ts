import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { openDatabase } from '../../storage/database/connection';
import { layoutPresets } from '../catalog';
import { isValidTemplateDocument } from '../domain/template-document';
import { templateFromCatalogPreset } from '../domain/template-builder';
import { builtinTemplates, ensureBuiltinTemplates, listTemplates, loadTemplate, saveTemplate } from './template-repository';
import { createSession } from '../../capture/node';
import { loadSession } from '../../capture/node';

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-templates-'));
  initializeStorage(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

describe('template storage', () => {
  it('creates the template tables in the migration', () => {
    const database = openDatabase(directory);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => (row as { name: string }).name);
    database.close();
    expect(tables).toContain('templates');
    expect(tables).toContain('template_elements');
  });

  it('seeds the six catalog layouts plus grid templates for the new sizes', () => {
    const templates = listTemplates(directory);
    for (const preset of layoutPresets) expect(templates.some((template) => template.id === preset.id)).toBe(true);
    const newSizes = templates.filter((template) => ['2x6-strip', '5x7', 'square'].includes(template.pagePreset));
    expect(newSizes).toHaveLength(18);
    for (const shots of [1, 2, 3, 4, 5, 6]) expect(newSizes.some((template) => template.shots === shots)).toBe(true);
    expect(templates.every((template) => template.builtIn)).toBe(true);
  });

  it('is idempotent: seeding twice keeps one copy of each template', () => {
    ensureBuiltinTemplates(directory);
    ensureBuiltinTemplates(directory);
    const database = openDatabase(directory);
    const count = database.prepare('SELECT COUNT(*) AS count FROM templates').get() as { count: number };
    const elements = database.prepare('SELECT COUNT(*) AS count FROM template_elements').get() as { count: number };
    database.close();
    expect(count.count).toBe(builtinTemplates().length);
    expect(elements.count).toBe(builtinTemplates().reduce((total, document) => total + document.elements.length, 0));
  });

  it('round-trips every element kind without losing fields', () => {
    const original = templateFromCatalogPreset(layoutPresets[0]!);
    saveTemplate(directory, original);
    const loaded = loadTemplate(directory, original.id);
    expect(loaded).toEqual(original);
    expect(isValidTemplateDocument(loaded)).toBe(true);
  });

  it('round-trips a generated 5x7 template', () => {
    const templates = listTemplates(directory);
    const fiveBySeven = templates.find((template) => template.pagePreset === '5x7' && template.shots === 3)!;
    const loaded = loadTemplate(directory, fiveBySeven.id);
    expect(loaded.page.widthPx).toBe(1500);
    expect(loaded.page.heightPx).toBe(2100);
    expect(loaded.elements.filter((element) => element.kind === 'photo')).toHaveLength(3);
  });

  it('rejects an unknown template id with an operator-readable message', () => {
    expect(() => loadTemplate(directory, 'double-strip-9')).toThrow(/does not exist/);
  });

  it('refuses to save an invalid template', () => {
    const document = { ...templateFromCatalogPreset(layoutPresets[0]!), shots: 9 };
    expect(() => saveTemplate(directory, document)).toThrow(/between 1 and 6/);
  });

  it('reports a corrupted stored template instead of rendering it', () => {
    ensureBuiltinTemplates(directory);
    const database = openDatabase(directory);
    database.prepare('DELETE FROM template_elements WHERE template_id = ? AND slot_number = 2').run('single-2-portrait');
    database.close();
    expect(() => loadTemplate(directory, 'single-2-portrait')).toThrow(/invalid: Template is missing a box for photo 2/);
  });

  it('keeps existing templates when a new built-in is added later', () => {
    const custom = { ...templateFromCatalogPreset(layoutPresets[0]!), id: 'custom-1', name: 'Custom' };
    saveTemplate(directory, custom);
    const database = openDatabase(directory);
    database.prepare('DELETE FROM templates WHERE id = ?').run('5x7-2x1');
    database.close();
    ensureBuiltinTemplates(directory);
    expect(listTemplates(directory).some((template) => template.id === 'custom-1')).toBe(true);
    expect(listTemplates(directory).some((template) => template.id === '5x7-2x1')).toBe(true);
  });
});

describe('upgrading a booth that predates templates', () => {
  it('adds the template tables and keeps existing sessions intact', async () => {
    const created = createSession(directory);
    expect(loadSession(directory, created.sessionId).slots).toHaveLength(3);

    // Simulate a database created before migration 008 existed.
    const database = openDatabase(directory);
    database.exec('DROP TABLE template_elements; DROP TABLE templates;');
    database.prepare("DELETE FROM schema_migrations WHERE name IN ('008_templates', '009_template_assets')").run();
    database.close();

    initializeStorage(directory);

    const summary = listTemplates(directory);
    expect(summary.length).toBe(builtinTemplates().length);
    expect(loadSession(directory, created.sessionId).slots).toHaveLength(3);
  });
});
