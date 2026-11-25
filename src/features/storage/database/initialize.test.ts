import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initializeStorage } from './initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';

const temporaryDirectories: string[] = [];
function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-f0-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('initializeStorage', () => {
  it('creates configured folders, the database, and all F0 tables', () => {
    const userData = makeTemporaryDirectory();
    initializeStorage(userData);

    const config = JSON.parse(fs.readFileSync(path.join(userData, 'photobooth-paths.json'), 'utf8')) as {
      photosDirectory: string; backupDirectory: string;
    };
    expect(fs.statSync(config.photosDirectory).isDirectory()).toBe(true);
    expect(fs.statSync(config.backupDirectory).isDirectory()).toBe(true);

    const database = new Database(path.join(userData, 'photobooth.sqlite'));
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => (row as { name: string }).name);
    for (const table of ['settings', 'events', 'sessions', 'slots', 'photos', 'outputs', 'upload_queue']) {
      expect(tables).toContain(table);
    }
    database.close();
  });

  it('repairs a database created by a build that made the template tables outside the migration list', () => {
    // What the user's Windows database was in: `templates` and `template_elements` exist, but
    // `008_templates` was never recorded, so every start died with `table templates already
    // exists` before a window appeared.
    const userData = makeTemporaryDirectory();
    initializeStorage(userData);
    const databasePath = path.join(userData, 'photobooth.sqlite');
    const first = new Database(databasePath);
    first.prepare("INSERT INTO templates (id, name, shots, copies, page_preset, page_width_px, page_height_px, margin_px, header_height_px, footer_height_px) VALUES ('kept', 'Kept layout', 3, 1, '4x6', 1200, 1800, 36, 120, 300)").run();
    first.prepare("DELETE FROM schema_migrations WHERE name = '008_templates'").run();
    first.close();

    expect(initializeStorage(userData)).toEqual([
      '008_templates: table templates already exists',
      '008_templates: table template_elements already exists',
    ]);

    const second = new Database(databasePath);
    expect(second.prepare("SELECT 1 FROM schema_migrations WHERE name = '008_templates'").get()).toBeTruthy();
    expect(second.prepare('SELECT name FROM templates').get()).toEqual({ name: 'Kept layout' });
    second.close();
    // Third start: nothing left to repair.
    expect(initializeStorage(userData)).toEqual([]);
  });

  it('rebuilds the template tables of an early database and lets the built-in layouts be seeded', () => {
    // The user's Windows database, as far as its shape goes: migrations 001-007 recorded, and
    // template tables created by that older build in miniature. The booth must open, not stop.
    const userData = makeTemporaryDirectory();
    initializeStorage(userData);
    const databasePath = path.join(userData, 'photobooth.sqlite');
    const early = new Database(databasePath);
    early.exec(`
      DROP TABLE template_elements;
      DROP TABLE templates;
      CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, shots INTEGER NOT NULL, copies INTEGER NOT NULL);
      CREATE TABLE template_elements (template_id TEXT NOT NULL, kind TEXT NOT NULL, layer INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL);
      DELETE FROM schema_migrations WHERE name IN ('008_templates', '009_template_assets', '010_event_layout_choices');
    `);
    early.prepare("INSERT INTO templates (id, name, shots, copies) VALUES ('early', 'Early strip', 3, 1)").run();
    early.close();

    const repairs = initializeStorage(userData);

    const rebuilt = repairs.filter((line) => line.includes('renamed to'));
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt[0]).toMatch(/^template_elements had an older shape, so it was renamed to template_elements_legacy_[0-9T]+ and recreated/);
    expect(rebuilt[1]).toMatch(/^templates had an older shape, so it was renamed to templates_legacy_[0-9T]+ and recreated/);
    // Everything else it reports is an adoption (a statement whose work was already there).
    for (const line of repairs.filter((entry) => !entry.includes('renamed to'))) {
      expect(line).toMatch(/already exists|duplicate column name/);
    }
    // The next line of the real startup, and the thing the user needs: layouts seed into the new table.
    ensureBuiltinTemplates(userData);
    const repaired = new Database(databasePath);
    const builtins = repaired.prepare('SELECT count(*) AS n FROM templates WHERE is_builtin = 1').get() as { n: number };
    expect(builtins.n).toBeGreaterThan(0);
    // The old row is parked, not deleted.
    const parked = repaired.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'templates_legacy_%'").get() as { n: number };
    expect(parked.n).toBe(1);
    repaired.close();
    expect(initializeStorage(userData)).toEqual([]);
  });

  it('respects custom photo and backup paths', () => {
    const userData = makeTemporaryDirectory();
    const photoPath = path.join(userData, 'custom-photos');
    const backupPath = path.join(userData, 'custom-backups');
    fs.writeFileSync(path.join(userData, 'photobooth-paths.json'), JSON.stringify({ photosDirectory: photoPath, backupDirectory: backupPath }));
    initializeStorage(userData);
    expect(fs.statSync(photoPath).isDirectory()).toBe(true);
    expect(fs.statSync(backupPath).isDirectory()).toBe(true);
  });
});
