import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { saveEventSettings, selectActiveEvent } from '../../events/node';
import { createSession, saveOriginalPhoto, saveSessionOutput } from '../../capture/node';
import { setAdminPin } from '../../security/admin-pin';
import { createSessionShareLink } from '../../sharing/node';
import { createDownloadServer } from '../../sharing/download-server';
import { readBoothStats } from '../data/stats-repository';

const directories: string[] = [];
const servers: Server[] = [];
const tinyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function addSession(directory: string, eventId: string, slots: number, options: { retakes?: number; minutes?: number } = {}): Promise<string> {
  selectActiveEvent(directory, eventId);
  const { sessionId } = createSession(directory);
  for (let slot = 1; slot <= slots; slot += 1) await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
  await saveSessionOutput(directory, sessionId, tinyJpeg, 1200, 1800);
  const database = new Database(path.join(directory, 'photobooth.sqlite'));
  try {
    // Expressed from the finish backwards, because later writes (a share link) touch updated_at.
    database.prepare("UPDATE sessions SET created_at = datetime(updated_at, ?) WHERE id = ?")
      .run(`-${(options.minutes ?? 2) * 60} seconds`, sessionId);
    if (options.retakes) database.prepare('UPDATE sessions SET retakes_used = ? WHERE id = ?').run(options.retakes, sessionId);
  } finally { database.close(); }
  return sessionId;
}

async function fixture(): Promise<{ directory: string; galaId: string; weddingId: string; origin: string; token: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-dashboard-'));
  directories.push(directory);
  initializeStorage(directory);
  setAdminPin(directory, '381927');
  const gala = saveEventSettings(directory, {
    id: '', name: 'Gala', shots: 3, expiryDays: 30, eventDate: null, primaryColor: '#c90000', accentColor: '#f4f0ec',
    welcomeText: 'Welcome', thankYouText: 'Thanks', offeredLayoutIds: ['double-strip-3'],
  });
  const wedding = saveEventSettings(directory, {
    id: '', name: 'Wedding, night two', shots: 3, expiryDays: 30, eventDate: null, primaryColor: '#123456', accentColor: '#ffffff',
    welcomeText: 'Welcome', thankYouText: 'Thanks', offeredLayoutIds: ['double-strip-3'],
  });
  await addSession(directory, gala.id, 3, { retakes: 2, minutes: 1 });
  await addSession(directory, gala.id, 3, { minutes: 3 });
  await addSession(directory, wedding.id, 3, { retakes: 1, minutes: 2 });
  const { url } = createSessionShareLink(directory, (await addSession(directory, wedding.id, 3, { minutes: 2 })), 'https://photos.example.com');
  const token = url.split('/').at(-1)!;
  // Two printed sheets and one failed job for the gala, so "prints used" means what it says.
  const database = new Database(path.join(directory, 'photobooth.sqlite'));
  try {
    const sessionId = (database.prepare("SELECT id FROM sessions WHERE event_id = ? LIMIT 1").get(gala.id) as { id: string }).id;
    for (const status of ['done', 'done', 'failed']) {
      database.prepare("INSERT INTO print_jobs (id, session_id, event_id, printer_name, status) VALUES (lower(hex(randomblob(8))), ?, ?, 'DNP', ?)")
        .run(sessionId, gala.id, status);
    }
  } finally { database.close(); }

  const config = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string };
  const server = await createDownloadServer(directory, config.photosDirectory, { port: 0 });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  return { directory, galaId: gala.id, weddingId: wedding.id, origin: `http://127.0.0.1:${address.port}`, token };
}

/** The table is formatted for reading, so cells are compared without the whitespace between them. */
function tightCells(html: string): string {
  return html.replace(/<\/td>\s*<td>/g, '</td><td>').replace(/<\/th>\s*<th>/g, '</th><th>');
}

function form(pin: string): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `pin=${encodeURIComponent(pin)}`, redirect: 'manual' };
}

async function signIn(origin: string): Promise<string> {
  const response = await fetch(`${origin}/admin/login`, form('381927'));
  expect(response.status).toBe(303);
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0]!;
}

describe('the operator dashboard (F24)', () => {
  it('asks for the admin PIN before showing any numbers', async () => {
    const { origin } = await fixture();
    const page = await fetch(`${origin}/admin`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Admin PIN');
    expect(html).not.toContain('Sessions</th>');
    expect(page.headers.get('cache-control')).toBe('no-store');
    // The CSV is not a way around the door either.
    expect((await fetch(`${origin}/admin/numbers.csv`)).status).toBe(401);
  });

  it('signs in with the matching PIN and shows real per-event numbers', async () => {
    const { origin } = await fixture();
    const cookie = await signIn(origin);
    expect(cookie.startsWith('pb_dashboard=')).toBe(true);
    const page = await fetch(`${origin}/admin`, { headers: { cookie } });
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('Gala');
    expect(html).toContain('Wedding, night two');
    // Gala: 2 finished sessions, 6 photos, 2 retakes, 2 printed sheets, 2m 0s average.
    expect(tightCells(html)).toContain('<td>Gala</td><td>2</td><td>6</td><td>2</td><td>2</td><td>0</td><td>2m 00s</td>');
    expect(tightCells(html)).toContain('<td>All events</td>');
  });

  it('counts guest downloads, and the CSV carries the same numbers', async () => {
    const { origin, token } = await fixture();
    const listing = await (await fetch(`${origin}/api/v1/session/${token}`)).json() as { files: Array<{ id: string }> };
    await (await fetch(`${origin}/api/v1/file/${token}/${listing.files[0]!.id}`)).arrayBuffer();
    await (await fetch(`${origin}/api/v1/all/${token}`)).arrayBuffer();
    const cookie = await signIn(origin);
    const html = await (await fetch(`${origin}/admin`, { headers: { cookie } })).text();
    expect(tightCells(html)).toContain('<td>Wedding, night two</td><td>2</td><td>6</td><td>1</td><td>0</td><td>2</td><td>2m 00s</td>');

    const csv = await fetch(`${origin}/admin/numbers.csv`, { headers: { cookie } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('attachment');
    const body = await csv.text();
    expect(body.split('\r\n')[0]).toBe('Event,Sessions,Photos taken,Retakes,Prints used,Downloads,Average session seconds,Average session');
    expect(body).toContain('Gala,2,6,2,2,0,120,2m 00s');
    expect(body).toContain('"Wedding, night two",2,6,1,0,2,120,2m 00s');
  });

  it('refuses a wrong PIN, counts the tries, and then locks like the booth does', async () => {
    const { origin } = await fixture();
    const first = await fetch(`${origin}/admin/login`, form('000000'));
    expect(first.status).toBe(401);
    expect(await first.text()).toContain('4 tries left');
    let last = first;
    for (let attempt = 0; attempt < 4; attempt += 1) last = await fetch(`${origin}/admin/login`, form('000000'));
    expect(last.status).toBe(401);
    expect(await last.text()).toContain('Too many wrong PINs');
    // Even the right PIN is refused while the lock holds, and no cookie is handed out.
    const right = await fetch(`${origin}/admin/login`, form('381927'));
    expect(right.status).toBe(401);
    expect(right.headers.get('set-cookie')).toBeNull();
  });

  it('signs out and forgets the session', async () => {
    const { origin } = await fixture();
    const cookie = await signIn(origin);
    const out = await fetch(`${origin}/admin/logout`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
    expect(out.status).toBe(303);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    // The old cookie is no longer accepted on this server.
    expect((await fetch(`${origin}/admin`, { headers: { cookie } })).text()).resolves.toContain('Admin PIN');
  });

  it('answers unknown dashboard paths with its own 404, and leaves guest links alone', async () => {
    const { origin, token } = await fixture();
    expect((await fetch(`${origin}/admin/nope`)).status).toBe(404);
    expect((await fetch(`${origin}/d/${token}`)).status).toBe(200);
  });

  it('reads the same numbers the booth has recorded', async () => {
    const { directory, galaId } = await fixture();
    const stats = readBoothStats(directory, new Date('2026-11-24T10:00:00.000Z'));
    expect(stats.generatedAt).toBe('2026-11-24T10:00:00.000Z');
    const gala = stats.events.find((row) => row.eventId === galaId)!;
    expect(gala).toMatchObject({ sessions: 2, photos: 6, retakes: 2, prints: 2, downloads: 0, averageSessionSeconds: 120 });
    expect(stats.totals.sessions).toBe(4);
    expect(stats.totals.photos).toBe(12);
    expect(stats.totals.retakes).toBe(3);
    expect(stats.totals.averageSessionSeconds).toBe(120);
  });
});
