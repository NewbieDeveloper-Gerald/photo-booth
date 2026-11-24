import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { openDatabase } from '../../storage/database/connection';
import { ensureBuiltinTemplates, listTemplates } from '../../layouts/node';
import { duplicateEvent, getActiveEvent, listEvents, saveEventSettings, selectActiveEvent } from '../node';
import { createTemplate } from '../../layouts/node';
import { validateOfferedLayoutIds } from './event-validation';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-event-layouts-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

describe('layouts offered to guests (F13)', () => {
  it('starts every booth with the default layout only, so no picker appears', () => {
    const active = getActiveEvent(directory);
    expect(active.offeredLayoutIds).toEqual([active.defaultLayoutId]);
  });

  it('stores the chosen list in the order given, with the default first', () => {
    const saved = saveEventSettings(directory, input({ offeredLayoutIds: ['5x7-3x1', 'double-strip-3', 'square-3x1'] }));
    expect(saved.offeredLayoutIds).toEqual(['double-strip-3', '5x7-3x1', 'square-3x1']);
    // Reading the event back must preserve the order, not just the membership.
    const stored = listEvents(directory).find((event) => event.id === saved.id)!;
    expect(stored.offeredLayoutIds).toEqual(['double-strip-3', '5x7-3x1', 'square-3x1']);
    // The default event keeps its own single-layout list.
    expect(getActiveEvent(directory).offeredLayoutIds).toEqual(['double-strip-3']);
  });

  it('drops layouts that do not exist and de-duplicates', () => {
    const saved = saveEventSettings(directory, input({ offeredLayoutIds: ['double-strip-3', 'ghost-layout', 'double-strip-3'] }));
    expect(saved.offeredLayoutIds).toEqual(['double-strip-3']);
  });

  it('falls back to the default layout when nothing valid is offered', () => {
    const saved = saveEventSettings(directory, input({ offeredLayoutIds: ['ghost-layout'] }));
    expect(saved.offeredLayoutIds).toEqual(['double-strip-3']);
  });

  it('keeps a custom layout in the list', () => {
    const custom = createTemplate(directory, { pageId: '5x7', shots: 3, name: 'Gala print' });
    const saved = saveEventSettings(directory, input({ offeredLayoutIds: [custom.id, 'double-strip-3'] }));
    expect(saved.offeredLayoutIds).toContain(custom.id);
    expect(listEvents(directory).find((event) => event.id === saved.id)!.offeredLayoutIds).toContain(custom.id);
  });

  it('survives a corrupt stored list by falling back to the default', () => {
    saveEventSettings(directory, input({ name: 'Broken', offeredLayoutIds: ['double-strip-3'] }));
    const created = listEvents(directory).find((event) => event.name === 'Broken')!;
    const database = openDatabase(directory);
    database.prepare("UPDATE events SET offered_layout_ids = 'not json' WHERE id = ?").run(created.id);
    database.close();
    const reloaded = listEvents(directory).find((event) => event.name === 'Broken')!;
    expect(reloaded.offeredLayoutIds).toEqual([reloaded.defaultLayoutId]);
  });

  it('copies the offered list when an event is duplicated', () => {
    const saved = saveEventSettings(directory, input({ offeredLayoutIds: ['5x7-4x1', 'double-strip-3'] }));
    const copy = duplicateEvent(directory, saved.id);
    expect(copy.offeredLayoutIds).toEqual(saved.offeredLayoutIds);
  });

  it('validates the shape of the list before it reaches the database', () => {
    expect(validateOfferedLayoutIds(undefined)).toEqual([]);
    expect(validateOfferedLayoutIds(['a', 'b'])).toEqual(['a', 'b']);
    expect(validateOfferedLayoutIds(['a', 'a'])).toEqual(['a']);
    expect(() => validateOfferedLayoutIds('double-strip-3')).toThrow(/Invalid list of guest layouts/);
    expect(() => validateOfferedLayoutIds([1, 2])).toThrow(/Invalid list of guest layouts/);
    expect(() => validateOfferedLayoutIds(Array.from({ length: 13 }, (_, index) => `layout-${index}`))).toThrow(/at most 12 layouts/);
  });

  it('shows the offered layouts when the event becomes active', () => {
    const saved = saveEventSettings(directory, input({ name: 'Wedding', offeredLayoutIds: ['5x7-2x1', 'double-strip-2'] }));
    const active = selectActiveEvent(directory, saved.id);
    // The event's own default layout leads the guest list, so the picker always has a sane first choice.
    expect(active.offeredLayoutIds).toEqual(['double-strip-3', '5x7-2x1', 'double-strip-2']);
    expect(listTemplates(directory).map((template) => template.id)).toEqual(expect.arrayContaining(active.offeredLayoutIds));
  });
});
