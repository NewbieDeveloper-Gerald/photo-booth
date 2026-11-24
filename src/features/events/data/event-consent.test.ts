import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';
import { duplicateEvent, getActiveEvent, listEvents, saveEventSettings } from '../node';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-event-consent-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

describe('per-event consent and contact details (F15)', () => {
  it('starts blank so the booth-wide wording is used', () => {
    expect(getActiveEvent(directory)).toMatchObject({ consentText: '', contactText: '' });
  });

  it('stores and returns the event’s own consent notice and contact details', () => {
    const saved = saveEventSettings(directory, input({ consentText: 'Photos are kept for 30 days for this wedding.', contactText: 'Message @partybooth' }));
    expect(saved).toMatchObject({ consentText: 'Photos are kept for 30 days for this wedding.', contactText: 'Message @partybooth' });
    expect(listEvents(directory).find((event) => event.id === saved.id)).toMatchObject({ contactText: 'Message @partybooth' });
  });

  it('trims surrounding whitespace and accepts a cleared notice', () => {
    const saved = saveEventSettings(directory, input({ consentText: '  Short notice  ', contactText: '  hi@example.com  ' }));
    expect(saved).toMatchObject({ consentText: 'Short notice', contactText: 'hi@example.com' });
    expect(saveEventSettings(directory, { ...saved, consentText: '', contactText: '' })).toMatchObject({ consentText: '', contactText: '' });
  });

  it('rejects text that is too long for the page', () => {
    expect(() => saveEventSettings(directory, input({ contactText: 'x'.repeat(201) }))).toThrow(/Contact details must be 200 characters or fewer/);
    expect(() => saveEventSettings(directory, input({ consentText: 'x'.repeat(1201) }))).toThrow(/Consent notice must be 1200 characters or fewer/);
  });

  it('copies both onto a duplicated event', () => {
    const saved = saveEventSettings(directory, input({ consentText: 'Notice', contactText: 'Contact' }));
    expect(duplicateEvent(directory, saved.id)).toMatchObject({ consentText: 'Notice', contactText: 'Contact' });
  });
});
