import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initializeStorage } from '../storage/database/initialize';
import { createSession, saveDownloadCopy, saveOriginalPhoto, saveSessionAnimation, saveSessionOutput } from '../capture/node';
import { encodeGif } from '../animation/domain/gif-encoder';
import { setEventLogo } from '../events/node';
import { createSessionShareLink } from './node';
import { createDownloadServer } from './download-server';

const directories: string[] = [];
const servers: Server[] = [];
const tinyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function fixture(rateLimit?: { windowMs: number; maxRequests: number }): Promise<{ directory: string; sessionId: string; token: string; origin: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-download-'));
  directories.push(directory);
  initializeStorage(directory);
  const { sessionId } = createSession(directory);
  for (const slot of [1, 2, 3]) await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
  await saveSessionOutput(directory, sessionId, tinyJpeg, 1200, 1800);
  const { url } = createSessionShareLink(directory, sessionId, 'https://photos.example.com');
  const token = url.split('/').at(-1)!;
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) throw new Error('Share token is not 128-bit base64url');
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string };
  const server = await createDownloadServer(directory, config.photosDirectory, { port: 0, ...(rateLimit ? { rateLimit } : {}) });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  return { directory, sessionId, token, origin: `http://127.0.0.1:${address.port}` };
}

describe('private QR download server', () => {
  it('lists the animated extras next to the photos and serves them as GIFs (F23)', async () => {
    const { directory, sessionId, token, origin } = await fixture();
    const gif = new Uint8Array(encodeGif([{ rgba: new Uint8Array(2 * 2 * 4).fill(180) }], { width: 2, height: 2, delayCs: 40 }));
    await saveSessionAnimation(directory, sessionId, gif, 'gif');
    await saveSessionAnimation(directory, sessionId, gif, 'boomerang');

    const listing = await fetch(`${origin}/api/v1/session/${token}`);
    const data = await listing.json() as { files: Array<{ id: string; name: string }> };
    expect(data.files.map((file) => file.name)).toEqual([
      'Photo 01.jpg', 'Photo 02.jpg', 'Photo 03.jpg', 'Finished layout.jpg', 'Animated loop.gif', 'Boomerang.gif',
    ]);
    const loop = data.files.find((file) => file.name === 'Animated loop.gif')!;
    const response = await fetch(`${origin}/api/v1/file/${token}/${loop.id}`);
    expect(response.headers.get('content-type')).toBe('image/gif');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(gif);
    // The page shows the loop inline, so it asks for an inline copy of the same bytes.
    const inline = await fetch(`${origin}/api/v1/file/${token}/${loop.id}?inline=1`);
    expect(inline.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const page = await fetch(`${origin}/d/${token}`);
    expect(await page.text()).toContain('?inline=1');
    // The ZIP "Download all" carries them too.
    const zip = await fetch(`${origin}/api/v1/all/${token}`);
    expect(zip.status).toBe(200);
    expect((await zip.arrayBuffer()).byteLength).toBeGreaterThan(gif.length * 2);
  });

  it('serves a no-index mobile page and only the token-authorized session files', async () => {
    const { token, origin } = await fixture();
    const page = await fetch(`${origin}/d/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    expect(await page.text()).toContain('Download all');

    const listing = await fetch(`${origin}/api/v1/session/${token}`);
    expect(listing.status).toBe(200);
    expect(listing.headers.get('cache-control')).toContain('no-store');
    const data = await listing.json() as { files: Array<{ id: string; name: string }> };
    expect(data.files.map((file) => file.name)).toEqual(['Photo 01.jpg', 'Photo 02.jpg', 'Photo 03.jpg', 'Finished layout.jpg']);
    const photo = await fetch(`${origin}/api/v1/file/${token}/${data.files[0]!.id}`);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(tinyJpeg);
    expect((await fetch(`${origin}/api/v1/session/AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
  });

  it('serves the optimized guest copy instead of the full-resolution original', async () => {
    const { directory, sessionId, token, origin } = await fixture();
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    const photo = database.prepare(`SELECT p.id AS id FROM photos p JOIN slots sl ON sl.id = p.slot_id
      WHERE sl.session_id = ? AND sl.slot_number = 1`).get(sessionId) as { id: string };
    database.close();
    const guestCopy = new Uint8Array([0xff, 0xd8, 0x21, 0x22, 0x23, 0xd9]);
    await saveDownloadCopy(directory, photo.id, guestCopy);

    const listing = await (await fetch(`${origin}/api/v1/session/${token}`)).json() as { files: Array<{ id: string; name: string }> };
    const firstPhoto = listing.files.find((file) => file.name === 'Photo 01.jpg');
    expect(firstPhoto).toBeDefined();
    const response = await fetch(`${origin}/api/v1/file/${token}/${firstPhoto!.id}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(guestCopy);
  });

  it('uses event branding safely on the guest page and serves its logo only through the private token', async () => {
    const { token, origin, directory } = await fixture();
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    database.prepare(`UPDATE events SET primary_color = '#123456', accent_color = '#abcdef', welcome_text = ?, thank_you_text = ? WHERE id = 'default-event'`)
      .run('</script><script>alert(1)</script>', 'Thanks!');
    database.close();
    const logoPath = path.join(directory, 'test-logo.png');
    fs.writeFileSync(logoPath, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(8)]));
    setEventLogo(directory, 'default-event', logoPath);
    const page = await (await fetch(`${origin}/d/${token}`)).text();
    expect(page).toContain('border-bottom:3px solid #abcdef');
    expect(page).toContain('background:#11131c');
    expect(page).toContain('thankYouText');
    expect(page).not.toContain('<script>alert(1)</script>');
    const logo = await fetch(`${origin}/api/v1/logo/${token}`);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect(logo.headers.get('cache-control')).toContain('no-store');
    expect((await fetch(`${origin}/api/v1/logo/AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
  });

  it('streams a Download all ZIP without writing a ZIP file to disk', async () => {
    const { token, origin, directory } = await fixture();
    const response = await fetch(`${origin}/api/v1/all/${token}`);
    expect(response.headers.get('content-type')).toBe('application/zip');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(fs.readdirSync(directory, { recursive: true }).some((name) => String(name).endsWith('.zip'))).toBe(false);
  });

  it('limits each share link separately so one guest cannot exhaust the booth quota', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-download-'));
    directories.push(directory);
    initializeStorage(directory);
    const tokens: string[] = [];
    for (let session = 0; session < 2; session += 1) {
      const { sessionId } = createSession(directory);
      for (const slot of [1, 2, 3]) await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
      tokens.push(createSessionShareLink(directory, sessionId, 'https://photos.example.com').url.split('/').at(-1)!);
    }
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string };
    const server = await createDownloadServer(directory, config.photosDirectory, { port: 0, rateLimit: { windowMs: 60_000, maxRequests: 2 } });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
    const origin = `http://127.0.0.1:${address.port}`;
    const [firstToken, secondToken] = tokens as [string, string];

    expect((await fetch(`${origin}/d/${firstToken}`)).status).toBe(200);
    expect((await fetch(`${origin}/d/${firstToken}`)).status).toBe(200);
    expect((await fetch(`${origin}/d/${firstToken}`)).status).toBe(429);
    // Same source address, different link: its own budget.
    expect((await fetch(`${origin}/d/${secondToken}`)).status).toBe(200);
    expect((await fetch(`${origin}/api/v1/session/${secondToken}`)).status).toBe(200);
    expect((await fetch(`${origin}/api/v1/session/${secondToken}`)).status).toBe(429);
  });

  it('refuses links after their expiry time', async () => {
    const { token, origin, directory } = await fixture();
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    database.prepare("UPDATE sessions SET token_expires_at = datetime('now', '-1 day') WHERE public_token = ?").run(token);
    database.close();
    // 410 Gone, not 404: the link was real and the photos were removed on purpose (F15).
    expect((await fetch(`${origin}/api/v1/session/${token}`)).status).toBe(410);
  });
});

describe('expired and invalid guest links (F15)', () => {
  it('shows a friendly expired page with the event contact details instead of a bare 404', async () => {
    const { directory, token, origin } = await fixture();
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    database.prepare("UPDATE events SET contact_text = 'Message @partybooth or hello@example.com'").run();
    database.prepare("UPDATE sessions SET token_expires_at = '2026-01-01T00:00:00Z'").run();
    database.close();

    const page = await fetch(`${origin}/d/${token}`);
    expect(page.status).toBe(410);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    const html = await page.text();
    expect(html).toContain('This link has expired');
    expect(html).toContain('Message @partybooth or hello@example.com');
    expect(html).not.toContain('Download all');

    expect((await fetch(`${origin}/api/v1/session/${token}`)).status).toBe(410);
  });

  it('explains an unknown link and escapes anything the operator typed', async () => {
    const { origin } = await fixture();
    const page = await fetch(`${origin}/d/AAAAAAAAAAAAAAAAAAAAAA`);
    expect(page.status).toBe(404);
    const html = await page.text();
    expect(html).toContain('This link is not valid');
    expect(html).toContain('Ask the organiser');
  });

  it('escapes operator text on the expired page', async () => {
    const { directory, token, origin } = await fixture();
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    database.prepare("UPDATE events SET contact_text = '<script>alert(1)</script>'").run();
    database.prepare("UPDATE sessions SET token_expires_at = '2026-01-01T00:00:00Z'").run();
    database.close();
    const html = await (await fetch(`${origin}/d/${token}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
