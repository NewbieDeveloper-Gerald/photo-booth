import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';
import { saveEventSettings, selectActiveEvent } from '../../events/node';
import { createSession, loadSession } from './session-repository';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-session-filter-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

/** Saves and activates an event so the session picks up its look rules. */
function activate(overrides: Record<string, unknown>): void {
  selectActiveEvent(directory, saveEventSettings(directory, input(overrides)).id);
}

describe('session photo look (F20)', () => {
  it('uses the event look when nothing is asked for', () => {
    activate({ filterId: 'mono' });
    const created = createSession(directory, 'double-strip-3');
    expect(created.filterId).toBe('mono');
    expect(loadSession(directory, created.sessionId).filterId).toBe('mono');
  });

  it('keeps the guest choice when the event allows it', () => {
    activate({ filterId: 'warm', filterChoiceEnabled: true });
    const created = createSession(directory, 'double-strip-3', 'beauty');
    expect(created.filterId).toBe('beauty');
    expect(loadSession(directory, created.sessionId).filterId).toBe('beauty');
    expect(createSession(directory, 'double-strip-3', 'none').filterId).toBe('none');
  });

  it('ignores a requested look when the operator locked one', () => {
    activate({ filterId: 'mono', filterChoiceEnabled: false });
    expect(createSession(directory, 'double-strip-3', 'beauty').filterId).toBe('mono');
    expect(loadSession(directory, createSession(directory, 'double-strip-3').sessionId).filterId).toBe('mono');
  });

  it('rejects a look that does not exist', () => {
    activate({ filterChoiceEnabled: true });
    expect(() => createSession(directory, 'double-strip-3', 'neon')).toThrow(/available photo filters/);
  });
});
