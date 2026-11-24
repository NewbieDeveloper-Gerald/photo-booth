import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from './database';
import { createSession, loadSession } from '../features/capture';
import { duplicateEvent, getActiveEvent, getEventLogoDataUrl, listEvents, saveEventSettings, selectActiveEvent, setEventLogo } from '../features/events';

const dirs: string[] = [];
function setup(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-events-')); dirs.push(dir); initializeStorage(dir); return dir; }
const input = (overrides: Record<string, unknown> = {}) => ({ id: '', name: 'Reception', shots: 2, expiryDays: 7, eventDate: '2027-02-28', primaryColor: '#123456', accentColor: '#abcdef', welcomeText: 'Welcome!', thankYouText: 'Thanks for celebrating!', ...overrides });
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('event setup and branding', () => {
  it('creates, edits, duplicates and activates events; sessions retain the selected event and its shot count', () => {
    const dir = setup();
    const created = saveEventSettings(dir, input());
    expect(created).toMatchObject({ name: 'Reception', shots: 2, expiryDays: 7, defaultLayoutId: 'double-strip-2' });
    expect(selectActiveEvent(dir, created.id)).toMatchObject({ id: created.id, shots: 2, defaultLayoutId: 'double-strip-2' });
    const session = createSession(dir, created.defaultLayoutId);
    expect(loadSession(dir, session.sessionId)).toMatchObject({ eventId: created.id, slots: [{ slotNumber: 1 }, { slotNumber: 2 }] });
    const edited = saveEventSettings(dir, { ...created, welcomeText: 'Doors are open!' });
    expect(edited.welcomeText).toBe('Doors are open!');
    const copy = duplicateEvent(dir, created.id);
    expect(copy).toMatchObject({ name: 'Reception Copy', shots: 2, welcomeText: 'Doors are open!' });
    expect(listEvents(dir).map((item) => item.id)).toEqual(expect.arrayContaining([created.id, copy.id, 'default-event']));
    expect(getActiveEvent(dir).id).toBe(created.id);
    expect(selectActiveEvent(dir, copy.id).id).toBe(copy.id);
  });

  it('validates event name, supported shot count, colors, expiry and real calendar dates', () => {
    const dir = setup();
    expect(() => saveEventSettings(dir, input({ name: ' ' }))).toThrow(/Event name/);
    expect(() => saveEventSettings(dir, input({ shots: 5 }))).toThrow(/shot count supported by the current layouts/);
    expect(() => saveEventSettings(dir, input({ primaryColor: 'red' }))).toThrow(/hex color/);
    expect(() => saveEventSettings(dir, input({ expiryDays: 366 }))).toThrow(/1 to 365/);
    expect(() => saveEventSettings(dir, input({ eventDate: '2027-02-30' }))).toThrow(/valid event date/);
  });

  it('copies a valid local PNG logo into event assets and duplicates the asset separately', () => {
    const dir = setup();
    const event = saveEventSettings(dir, input());
    const logo = path.join(dir, 'source.png');
    fs.writeFileSync(logo, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]));
    const savedPath = setEventLogo(dir, event.id, logo);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(getEventLogoDataUrl(dir, event.id)).toMatch(/^data:image\/png;base64,/);
    const copy = duplicateEvent(dir, event.id);
    expect(copy.logoPath).not.toBe(savedPath);
    expect(copy.logoPath && fs.existsSync(copy.logoPath)).toBe(true);
    expect(getEventLogoDataUrl(dir, copy.id)).toMatch(/^data:image\/png;base64,/);
    const invalid = path.join(dir, 'bad.png'); fs.writeFileSync(invalid, 'not png');
    expect(() => setEventLogo(dir, event.id, invalid)).toThrow(/image file/);
  });
});
