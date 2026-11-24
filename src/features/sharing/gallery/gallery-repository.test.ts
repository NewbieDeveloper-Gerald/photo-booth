import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { duplicateEvent, saveEventSettings, selectActiveEvent } from '../../events/node';
import { createSession, saveOriginalPhoto } from '../../capture/node';
import { createEventGalleryLink, findGalleryEvent, listGallerySessions, setGalleryPassword, verifyGalleryPassword } from './gallery-repository';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

const tinyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const event = (overrides: Record<string, unknown> = {}) => ({
  id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null, primaryColor: '#c90000', accentColor: '#f4f0ec',
  welcomeText: 'Welcome', thankYouText: 'Thanks', offeredLayoutIds: ['double-strip-3'], consentText: '', contactText: '', ...overrides,
});

function setup(): { directory: string; eventId: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-gallery-'));
  directories.push(directory);
  initializeStorage(directory);
  const saved = saveEventSettings(directory, event());
  // Sessions join whichever event is active, exactly as on the booth.
  selectActiveEvent(directory, saved.id);
  return { directory, eventId: saved.id };
}

describe('event gallery link (F16)', () => {
  it('creates one stable link per event', () => {
    const { directory, eventId } = setup();
    const first = createEventGalleryLink(directory, eventId, 'https://photos.example.com');
    const second = createEventGalleryLink(directory, eventId, 'https://photos.example.com');
    expect(first.url).toBe(second.url);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.url).toBe(`https://photos.example.com/g/${first.token}`);
    expect(first.passwordProtected).toBe(false);
  });

  it('refuses a non-HTTPS site and unknown events', () => {
    const { directory, eventId } = setup();
    expect(() => createEventGalleryLink(directory, eventId, 'http://photos.example.com')).toThrow(/HTTPS/);
    expect(() => createEventGalleryLink(directory, 'no-such-event', 'https://photos.example.com')).toThrow(/not found/);
  });

  it('finds the event by token and never exposes the password hash', () => {
    const { directory, eventId } = setup();
    const { token } = createEventGalleryLink(directory, eventId, 'https://photos.example.com');
    const found = findGalleryEvent(directory, token);
    expect(found).toMatchObject({ id: eventId, name: 'Gala' });
    expect(findGalleryEvent(directory, 'AAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(findGalleryEvent(directory, '../../etc')).toBeNull();
  });

  it('protects the gallery with a password that can be cleared again', () => {
    const { directory, eventId } = setup();
    const { token } = createEventGalleryLink(directory, eventId, 'https://photos.example.com');
    expect(setGalleryPassword(directory, eventId, 'sesame123')).toBe(true);
    const protectedEvent = findGalleryEvent(directory, token)!;
    expect(protectedEvent.passwordHash).toMatch(/^scrypt\$/);
    expect(verifyGalleryPassword(protectedEvent, 'sesame123')).toBe(true);
    expect(verifyGalleryPassword(protectedEvent, 'wrong')).toBe(false);
    expect(verifyGalleryPassword(protectedEvent, '')).toBe(false);
    expect(setGalleryPassword(directory, eventId, null)).toBe(false);
    expect(verifyGalleryPassword(findGalleryEvent(directory, token)!, undefined)).toBe(true);
  });

  it('gives a duplicated event a fresh gallery of its own', () => {
    const { directory, eventId } = setup();
    createEventGalleryLink(directory, eventId, 'https://photos.example.com');
    setGalleryPassword(directory, eventId, 'sesame123');
    const duplicate = duplicateEvent(directory, eventId);
    expect(duplicate).toMatchObject({ galleryToken: null, galleryPasswordSet: false });
    const original = findGalleryEvent(directory, createEventGalleryLink(directory, eventId, 'https://photos.example.com').token);
    expect(original?.passwordHash).not.toBeNull();
  });

  it('rejects a password that is too short', () => {
    const { directory, eventId } = setup();
    expect(() => setGalleryPassword(directory, eventId, 'abc')).toThrow(/4 to 64/);
  });

  it('lists only completed sessions that actually have photos', async () => {
    const { directory, eventId } = setup();
    const { sessionId } = createSession(directory);
    const emptySession = createSession(directory);
    expect(listGallerySessions(directory, eventId)).toEqual([]);
    for (const slot of [1, 2, 3]) await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
    const sessions = listGallerySessions(directory, eventId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe(sessionId);
    expect(sessions[0]!.photos.map((photo) => photo.slotNumber)).toEqual([1, 2, 3]);
    expect(sessions.some((session) => session.sessionId === emptySession.sessionId)).toBe(false);
  });
});
