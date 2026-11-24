import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';
import { duplicateEvent, listEvents, saveEventSettings } from '../node';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-event-attract-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

describe('per-event attract screen (F19)', () => {
  it('is on by default and waits a minute, so an existing event gains the loop', () => {
    expect(listEvents(directory).find((event) => event.id === 'default-event')).toMatchObject({
      attractEnabled: true, attractIdleSeconds: 60,
    });
  });

  it('stores the toggle and the wait', () => {
    const saved = saveEventSettings(directory, input({ attractEnabled: false, attractIdleSeconds: 15 }));
    expect(saved).toMatchObject({ attractEnabled: false, attractIdleSeconds: 15 });
    expect(listEvents(directory).find((event) => event.id === saved.id)).toMatchObject({ attractEnabled: false, attractIdleSeconds: 15 });
  });

  it('rejects a wait the booth cannot sit through', () => {
    expect(() => saveEventSettings(directory, input({ attractIdleSeconds: 4 }))).toThrow(/Attract screen wait must be 5 to 600 seconds/);
    expect(() => saveEventSettings(directory, input({ attractIdleSeconds: 601 }))).toThrow(/Attract screen wait must be 5 to 600 seconds/);
    expect(() => saveEventSettings(directory, input({ attractIdleSeconds: 12.5 }))).toThrow(/Attract screen wait must be 5 to 600 seconds/);
    expect(() => saveEventSettings(directory, input({ attractIdleSeconds: '60' }))).toThrow(/Attract screen wait must be 5 to 600 seconds/);
    expect(() => saveEventSettings(directory, input({ attractEnabled: 'yes' }))).toThrow(/Invalid attract screen setting/);
  });

  it('carries the loop settings into a duplicated event', () => {
    const source = saveEventSettings(directory, input({ attractEnabled: false, attractIdleSeconds: 30 }));
    expect(duplicateEvent(directory, source.id)).toMatchObject({ attractEnabled: false, attractIdleSeconds: 30 });
  });
});
