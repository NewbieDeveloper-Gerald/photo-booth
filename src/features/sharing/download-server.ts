import { ZipFile } from 'yazl';
import { openReadOnlyDatabase } from '../storage/database/connection';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { resolveInside } from '../../shared/fs/safe-paths';
import { isShareToken } from '../../shared/validation/identifiers';
import { DOWNLOAD_MAX_REQUESTS_PER_WINDOW, DOWNLOAD_RATE_WINDOW_MS, DOWNLOAD_SERVER_HOST, DOWNLOAD_SERVER_PORT } from '../../shared/constants/limits';
import { renderGuestPage, renderUnavailablePage } from './guest-page-html';
import type { DownloadFile, SessionDownload } from './guest-page-html';

/** Matches every route that carries a share token, so limits can be applied per guest link. */
const TOKEN_ROUTE_PATTERN = /^\/(?:d|api\/v1\/(?:session|all|file|logo))\/([A-Za-z0-9_-]{22})(?:\/|$)/;

export type DownloadServerOptions = {
  port?: number;
  host?: string;
  rateLimit?: { windowMs: number; maxRequests: number };
};

function noIndex(response: ServerResponse): void {
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

/**
 * Share tokens get their own bucket; everything else is grouped by address. A tunnel (Cloudflare,
 * ngrok) makes every guest look like 127.0.0.1, so address-only limits would throttle a whole event.
 */
function rateLimitKey(request: IncomingMessage, pathname: string): string {
  const token = TOKEN_ROUTE_PATTERN.exec(pathname)?.[1];
  return token ? `token:${token}` : `address:${request.socket.remoteAddress ?? 'unknown'}`;
}

function isLimited(request: IncomingMessage, pathname: string, buckets: Map<string, { started: number; count: number }>,
  windowMs: number, maxRequests: number): boolean {
  const key = rateLimitKey(request, pathname);
  const now = Date.now();
  if (buckets.size > 2048) {
    for (const [bucketKey, value] of buckets) if (now - value.started >= windowMs) buckets.delete(bucketKey);
    if (buckets.size > 4096 && !buckets.has(key)) return true;
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.started >= windowMs) { buckets.set(key, { started: now, count: 1 }); return false; }
  bucket.count += 1;
  return bucket.count > maxRequests;
}

function findSession(databasePath: string, photosRoot: string, token: string): SessionDownload | null {
  if (!isShareToken(token)) return null;
  const database = openReadOnlyDatabase(databasePath);
  try {
    const session = database.prepare(`SELECT s.id, e.name AS eventName, e.logo_path AS logoPath, e.primary_color AS primaryColor, e.accent_color AS accentColor, e.welcome_text AS welcomeText, e.thank_you_text AS thankYouText FROM sessions s JOIN events e ON e.id = s.event_id
      WHERE s.public_token = ? AND s.status = 'completed' AND s.token_expires_at IS NOT NULL
        AND julianday(s.token_expires_at) > julianday('now')`).get(token) as { id: string; eventName: string; logoPath: string | null; primaryColor: string; accentColor: string; welcomeText: string; thankYouText: string } | undefined;
    if (!session) return null;
    const photos = database.prepare(`SELECT p.id, p.original_path AS originalPath, p.download_path AS downloadPath, sl.slot_number AS slotNumber
      FROM sessions s JOIN slots sl ON sl.session_id = s.id JOIN photos p ON p.id = sl.current_photo_id
      WHERE s.id = ? ORDER BY sl.slot_number`).all(session.id) as Array<{ id: string; originalPath: string; downloadPath: string | null; slotNumber: number }>;
    const output = database.prepare(`SELECT id, output_path AS filePath FROM outputs WHERE session_id = ? AND kind LIKE 'finished-%'
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(session.id) as { id: string; filePath: string } | undefined;
    const files: DownloadFile[] = [];
    for (const photo of photos) {
      // Guests get the 2048px/q80 copy; sessions captured before download copies existed fall back to the original.
      const filePath = [photo.downloadPath, photo.originalPath]
        .map((candidate) => (candidate ? resolveInside(photosRoot, candidate) : null))
        .find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
      if (filePath) files.push({ id: photo.id, name: `Photo ${String(photo.slotNumber).padStart(2, '0')}.jpg`, filePath, kind: 'photo' });
    }
    if (output) {
      const filePath = resolveInside(photosRoot, output.filePath);
      if (filePath && fs.existsSync(filePath)) files.push({ id: output.id, name: 'Finished layout.jpg', filePath, kind: 'layout' });
    }
    return { eventName: session.eventName, logoPath: session.logoPath, primaryColor: session.primaryColor, accentColor: session.accentColor, welcomeText: session.welcomeText, thankYouText: session.thankYouText, files };
  } finally { database.close(); }
}

/** A real link whose sharing period has ended: enough branding to explain what happened. */
function findExpiredSession(databasePath: string, token: string): { eventName: string; contactText: string; primaryColor: string; accentColor: string } | null {
  if (!isShareToken(token)) return null;
  const database = openReadOnlyDatabase(databasePath);
  try {
    const session = database.prepare(`SELECT e.name AS eventName, e.contact_text AS contactText, e.primary_color AS primaryColor, e.accent_color AS accentColor
      FROM sessions s JOIN events e ON e.id = s.event_id
      WHERE s.public_token = ? AND s.token_expires_at IS NOT NULL AND julianday(s.token_expires_at) <= julianday('now')
      LIMIT 1`).get(token) as { eventName: string; contactText: string; primaryColor: string; accentColor: string } | undefined;
    return session ?? null;
  } finally { database.close(); }
}

export function createDownloadServer(userDataPath: string, photosRoot: string, options: DownloadServerOptions = {}): Promise<http.Server> {
  const { port = DOWNLOAD_SERVER_PORT, host = DOWNLOAD_SERVER_HOST,
    rateLimit = { windowMs: DOWNLOAD_RATE_WINDOW_MS, maxRequests: DOWNLOAD_MAX_REQUESTS_PER_WINDOW } } = options;
  const databasePath = path.join(userDataPath, 'photobooth.sqlite');
  const buckets = new Map<string, { started: number; count: number }>();
  const server = http.createServer((request, response) => {
    noIndex(response);
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (isLimited(request, url.pathname, buckets, rateLimit.windowMs, rateLimit.maxRequests)) { response.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Please wait before trying again.'); return; }
    const page = /^\/d\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (page) {
      const session = findSession(databasePath, photosRoot, page[1]!);
      const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
      if (session) { response.writeHead(200, htmlHeaders); response.end(request.method === 'HEAD' ? undefined : renderGuestPage(page[1]!, session)); return; }
      const expired = findExpiredSession(databasePath, page[1]!);
      response.writeHead(expired ? 410 : 404, htmlHeaders);
      response.end(request.method === 'HEAD' ? undefined : renderUnavailablePage(expired ? { reason: 'expired', ...expired } : { reason: 'invalid' }));
      return;
    }
    const logoRoute = /^\/api\/v1\/logo\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (logoRoute) {
      const session = findSession(databasePath, photosRoot, logoRoute[1]!);
      const logoPath = session?.logoPath;
      const eventAssetsRoot = path.resolve(path.dirname(databasePath), 'event-assets');
      const resolved = logoPath ? resolveInside(eventAssetsRoot, logoPath) : null;
      if (!resolved || !fs.existsSync(resolved)) { response.writeHead(404).end(); return; }
      const type = path.extname(resolved).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': fs.statSync(resolved).size, 'Content-Disposition': 'inline' });
      if (request.method === 'HEAD') { response.end(); return; }
      fs.createReadStream(resolved).pipe(response); return;
    }
    const listing = /^\/api\/v1\/session\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (listing) {
      const session = findSession(databasePath, photosRoot, listing[1]!);
      if (!session) {
        const isExpired = findExpiredSession(databasePath, listing[1]!) !== null;
        response.writeHead(isExpired ? 410 : 404, { 'Content-Type': 'application/json' }).end(isExpired ? '{"error":"expired"}' : '{"error":"not_found"}');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ eventName: session.eventName, files: session.files.map(({ id, name }) => ({ id, name })) }));
      return;
    }
    const all = /^\/api\/v1\/all\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (all) {
      const session = findSession(databasePath, photosRoot, all[1]!);
      if (!session) { response.writeHead(404).end(); return; }
      const zip = new ZipFile();
      zip.on('error', () => response.destroy());
      response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="photobooth-photos.zip"' });
      zip.outputStream.pipe(response);
      for (const file of session.files) zip.addFile(file.filePath, file.name, { compress: false });
      zip.end();
      return;
    }
    const fileRoute = /^\/api\/v1\/file\/([A-Za-z0-9_-]{22})\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (fileRoute) {
      const session = findSession(databasePath, photosRoot, fileRoute[1]!);
      const file = session?.files.find((candidate) => candidate.id === fileRoute[2]);
      if (!file) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="${file.name}"`, 'Content-Length': fs.statSync(file.filePath).size });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(file.filePath);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(server); });
  });
}
