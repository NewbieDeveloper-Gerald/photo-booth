import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initializeStorage } from './initialize';

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
