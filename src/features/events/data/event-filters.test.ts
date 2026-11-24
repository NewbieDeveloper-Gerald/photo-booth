import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';
import { duplicateEvent, listEvents, saveEventSettings } from '../node';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-event-filter-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

describe('per-event photo look (F20)', () => {
  it('starts unfiltered with the guest choice off', () => {
    expect(listEvents(directory).find((event) => event.id === 'default-event')).toMatchObject({
      filterId: 'none', filterChoiceEnabled: false,
    });
  });

  it('stores a locked look', () => {
    const saved = saveEventSettings(directory, input({ filterId: 'mono' }));
    expect(saved).toMatchObject({ filterId: 'mono', filterChoiceEnabled: false });
    expect(listEvents(directory).find((event) => event.id === saved.id)).toMatchObject({ filterId: 'mono' });
  });

  it('lets guests choose on top of a default look', () => {
    const saved = saveEventSettings(directory, input({ filterId: 'warm', filterChoiceEnabled: true }));
    expect(saved).toMatchObject({ filterId: 'warm', filterChoiceEnabled: true });
  });

  it('rejects a look the renderer does not know', () => {
    expect(() => saveEventSettings(directory, input({ filterId: 'sepia' }))).toThrow(/available photo filters/);
    // A missing value falls back to "Original" rather than failing an old payload.
    expect(saveEventSettings(directory, input({ filterId: null })).filterId).toBe('none');
    expect(() => saveEventSettings(directory, input({ filterChoiceEnabled: 'yes' }))).toThrow(/Invalid guest filter setting/);
  });

  it('carries the look into a duplicated event', () => {
    const source = saveEventSettings(directory, input({ filterId: 'beauty', filterChoiceEnabled: true }));
    expect(duplicateEvent(directory, source.id)).toMatchObject({ filterId: 'beauty', filterChoiceEnabled: true });
  });
});
