import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';
import { duplicateEvent, listEvents, saveEventSettings } from '../node';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-event-print-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

describe('per-event print rules (F18)', () => {
  it('starts at two prints per session and no paper count, so an old event keeps working', () => {
    expect(listEvents(directory).find((event) => event.id === 'default-event')).toMatchObject({
      printLimitPerSession: 2, paperCount: 0,
    });
  });

  it('stores the limit and the paper count', () => {
    const saved = saveEventSettings(directory, input({ printLimitPerSession: 4, paperCount: 300 }));
    expect(saved).toMatchObject({ printLimitPerSession: 4, paperCount: 300 });
    expect(listEvents(directory).find((event) => event.id === saved.id)).toMatchObject({ printLimitPerSession: 4, paperCount: 300 });
  });

  it('rejects a limit or paper count the queue cannot honour', () => {
    expect(() => saveEventSettings(directory, input({ printLimitPerSession: 0 }))).toThrow(/Prints per session must be 1 to 20/);
    expect(() => saveEventSettings(directory, input({ printLimitPerSession: 21 }))).toThrow(/Prints per session must be 1 to 20/);
    expect(() => saveEventSettings(directory, input({ printLimitPerSession: 2.5 }))).toThrow(/Prints per session must be 1 to 20/);
    expect(() => saveEventSettings(directory, input({ printLimitPerSession: '3' }))).toThrow(/Prints per session must be 1 to 20/);
    expect(() => saveEventSettings(directory, input({ paperCount: -1 }))).toThrow(/Paper count must be 0 to 5000 sheets/);
    expect(() => saveEventSettings(directory, input({ paperCount: 5001 }))).toThrow(/Paper count must be 0 to 5000 sheets/);
  });

  it('carries both rules into a duplicated event', () => {
    const source = saveEventSettings(directory, input({ printLimitPerSession: 5, paperCount: 120 }));
    const copy = duplicateEvent(directory, source.id);
    expect(copy).toMatchObject({ printLimitPerSession: 5, paperCount: 120 });
    expect(copy.id).not.toBe(source.id);
  });
});
