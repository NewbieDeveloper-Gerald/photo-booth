import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';
import { duplicateEvent, listEvents, saveEventSettings } from '../node';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-event-animation-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

describe('per-event animated extra (F23)', () => {
  it('defaults new and existing events to a GIF loop', () => {
    expect(listEvents(directory).find((event) => event.id === 'default-event')).toMatchObject({ animatedOutput: 'gif' });
    const saved = saveEventSettings(directory, input());
    expect(saved.animatedOutput).toBe('gif');
    // A payload from before F23 (no value at all) keeps working.
    expect(saveEventSettings(directory, input({ name: 'Old payload' })).animatedOutput).toBe('gif');
  });

  it('stores every choice the form offers', () => {
    for (const value of ['none', 'gif', 'boomerang', 'both']) {
      const saved = saveEventSettings(directory, input({ name: `Event ${value}`, animatedOutput: value }));
      expect(saved.animatedOutput).toBe(value);
      expect(listEvents(directory).find((event) => event.id === saved.id)).toMatchObject({ animatedOutput: value });
    }
  });

  it('refuses a value the booth cannot build', () => {
    expect(() => saveEventSettings(directory, input({ animatedOutput: 'video' }))).toThrow(/GIF loop/);
    expect(() => saveEventSettings(directory, input({ animatedOutput: 2 }))).toThrow(/GIF loop/);
  });

  it('copies the choice when an event is duplicated', () => {
    const source = saveEventSettings(directory, input({ animatedOutput: 'boomerang' }));
    expect(duplicateEvent(directory, source.id)).toMatchObject({ animatedOutput: 'boomerang' });
  });

  it('has a database default for rows written without the column', () => {
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    try {
      const row = database.prepare("SELECT animated_output AS value FROM events WHERE id = 'default-event'").get() as { value: string };
      expect(row.value).toBe('gif');
      const columns = database.prepare("SELECT name FROM pragma_table_info('events')").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain('animated_output');
    } finally { database.close(); }
  });
});
