import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/node';
import { duplicateEvent, listEvents, saveEventSettings } from '../node';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-event-watermark-'));
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const input = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null,
  primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome', thankYouText: 'Thanks',
  offeredLayoutIds: ['double-strip-3'], ...overrides,
});

describe('per-event watermark (F17)', () => {
  it('is off with sensible defaults until the operator enables it', () => {
    expect(listEvents(directory).find((event) => event.id === 'default-event')).toMatchObject({
      watermarkEnabled: false, watermarkPosition: 'bottom-right', watermarkScalePercent: 18, watermarkOpacity: 0.6,
    });
  });

  it('stores the corner, size and opacity', () => {
    const saved = saveEventSettings(directory, input({ watermarkEnabled: true, watermarkPosition: 'top-left', watermarkScalePercent: 30, watermarkOpacity: 0.45 }));
    expect(saved).toMatchObject({ watermarkEnabled: true, watermarkPosition: 'top-left', watermarkScalePercent: 30, watermarkOpacity: 0.45 });
    expect(listEvents(directory).find((event) => event.id === saved.id)).toMatchObject({ watermarkPosition: 'top-left' });
  });

  it('rejects a corner, size or opacity the renderer cannot draw', () => {
    expect(() => saveEventSettings(directory, input({ watermarkPosition: 'middle' }))).toThrow(/where the watermark sits/);
    expect(() => saveEventSettings(directory, input({ watermarkScalePercent: 4 }))).toThrow(/size must be 5–50%/);
    expect(() => saveEventSettings(directory, input({ watermarkScalePercent: 51 }))).toThrow(/size must be 5–50%/);
    expect(() => saveEventSettings(directory, input({ watermarkScalePercent: 12.5 }))).toThrow(/size must be 5–50%/);
    expect(() => saveEventSettings(directory, input({ watermarkOpacity: 0.05 }))).toThrow(/opacity must be/);
    expect(() => saveEventSettings(directory, input({ watermarkOpacity: 1.5 }))).toThrow(/opacity must be/);
    expect(() => saveEventSettings(directory, input({ watermarkEnabled: 'yes' }))).toThrow(/Invalid watermark setting/);
  });

  it('copies the watermark onto a duplicated event', () => {
    const saved = saveEventSettings(directory, input({ watermarkEnabled: true, watermarkPosition: 'center', watermarkScalePercent: 22 }));
    expect(duplicateEvent(directory, saved.id)).toMatchObject({ watermarkEnabled: true, watermarkPosition: 'center', watermarkScalePercent: 22 });
  });
});
