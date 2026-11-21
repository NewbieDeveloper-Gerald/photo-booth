import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initializeStorage } from '../storage/database';
import { createSession, createSessionShareLink, saveOriginalPhoto, saveSessionOutput } from '../storage/sessions';
import { createDownloadServer } from './download-server';

const directories: string[] = [];
const servers: Server[] = [];
const tinyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function fixture(): Promise<{ directory: string; sessionId: string; token: string; origin: string }> {
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
  const server = await createDownloadServer(directory, config.photosDirectory, 0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  return { directory, sessionId, token, origin: `http://127.0.0.1:${address.port}` };
}

describe('private QR download server', () => {
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

  it('streams a Download all ZIP without writing a ZIP file to disk', async () => {
    const { token, origin, directory } = await fixture();
    const response = await fetch(`${origin}/api/v1/all/${token}`);
    expect(response.headers.get('content-type')).toBe('application/zip');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(fs.readdirSync(directory, { recursive: true }).some((name) => String(name).endsWith('.zip'))).toBe(false);
  });

  it('refuses links after their expiry time', async () => {
    const { token, origin, directory } = await fixture();
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    database.prepare("UPDATE sessions SET token_expires_at = datetime('now', '-1 day') WHERE public_token = ?").run(token);
    database.close();
    expect((await fetch(`${origin}/api/v1/session/${token}`)).status).toBe(404);
  });
});
