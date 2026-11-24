import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../storage/database/initialize';
import { saveEventSettings, selectActiveEvent } from '../events/node';
import { createSession, saveDownloadCopy, saveOriginalPhoto, saveSessionOutput } from '../capture/node';
import { createEventGalleryLink, setGalleryPassword } from './gallery/gallery-repository';
import { createDownloadServer } from './download-server';

const directories: string[] = [];
const servers: Server[] = [];
const tinyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function fixture(): Promise<{ directory: string; eventId: string; token: string; origin: string; photoId: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-gallery-http-'));
  directories.push(directory);
  initializeStorage(directory);
  const event = saveEventSettings(directory, {
    id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null, primaryColor: '#c90000', accentColor: '#f4f0ec',
    welcomeText: 'Welcome', thankYouText: 'Thanks', offeredLayoutIds: ['double-strip-3'], consentText: '', contactText: 'Message @partybooth',
  });
  selectActiveEvent(directory, event.id);
  const { sessionId } = createSession(directory);
  let photoId = '';
  for (const slot of [1, 2, 3]) {
    const saved = await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
    if (slot === 1) { photoId = saved.photoId; await saveDownloadCopy(directory, saved.photoId, tinyJpeg); }
  }
  await saveSessionOutput(directory, sessionId, tinyJpeg, 1200, 1800);
  const { token } = createEventGalleryLink(directory, event.id, 'https://photos.example.com');
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string };
  const server = await createDownloadServer(directory, config.photosDirectory, { port: 0 });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  return { directory, eventId: event.id, token, origin: `http://127.0.0.1:${address.port}`, photoId };
}

describe('event gallery (F16)', () => {
  it('serves an unlocked gallery page and lists its sessions', async () => {
    const { token, origin, photoId } = await fixture();
    const page = await fetch(`${origin}/g/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await page.text()).toContain('Event gallery');

    const listing = await fetch(`${origin}/api/v1/gallery/${token}`);
    expect(listing.status).toBe(200);
    const data = await listing.json() as { eventName: string; sessions: Array<{ label: string; photos: Array<{ id: string }> }> };
    expect(data.eventName).toBe('Gala');
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]!.photos.map((photo) => photo.id)).toEqual(expect.arrayContaining([photoId]));

    const photo = await fetch(`${origin}/api/v1/gallery/${token}/photo/${photoId}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(tinyJpeg);
  });

  it('asks for the password, then hands out a grant that unlocks listing and photos', async () => {
    const { directory, eventId, token, origin, photoId } = await fixture();
    setGalleryPassword(directory, eventId, 'sesame123');

    expect((await fetch(`${origin}/api/v1/gallery/${token}`)).status).toBe(401);
    expect((await fetch(`${origin}/api/v1/gallery/${token}/photo/${photoId}`)).status).toBe(401);

    const wrong = await fetch(`${origin}/api/v1/gallery/${token}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) });
    expect(wrong.status).toBe(401);

    const right = await fetch(`${origin}/api/v1/gallery/${token}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sesame123' }) });
    expect(right.status).toBe(200);
    const { grant } = await right.json() as { grant: string };

    const listing = await fetch(`${origin}/api/v1/gallery/${token}`, { headers: { 'x-gallery-grant': grant } });
    expect(listing.status).toBe(200);
    expect((await fetch(`${origin}/api/v1/gallery/${token}/photo/${photoId}?grant=${grant}`)).status).toBe(200);
    // A grant for one gallery cannot open another.
    expect((await fetch(`${origin}/api/v1/gallery/AAAAAAAAAAAAAAAAAAAAAA`, { headers: { 'x-gallery-grant': grant } })).status).toBe(404);
  });

  it('answers 404 for an unknown gallery link and never serves other events’ photos', async () => {
    const { directory, token, origin } = await fixture();
    expect((await fetch(`${origin}/g/AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
    const other = saveEventSettings(directory, {
      id: '', name: 'Other', shots: 3, expiryDays: 30, eventDate: null, primaryColor: '#c90000', accentColor: '#f4f0ec',
      welcomeText: 'W', thankYouText: 'T', offeredLayoutIds: ['double-strip-3'], consentText: '', contactText: '',
    });
    const otherToken = createEventGalleryLink(directory, other.id, 'https://photos.example.com').token;
    expect((await fetch(`${origin}/api/v1/gallery/${otherToken}`).then((response) => response.json()) as { sessions: unknown[] }).sessions).toEqual([]);
    expect(token).not.toBe(otherToken);
  });
});
