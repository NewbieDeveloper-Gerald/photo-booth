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
