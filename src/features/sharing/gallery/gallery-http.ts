import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveInside } from '../../../shared/fs/safe-paths';
import { GALLERY_GRANT_TTL_MS } from '../../../shared/constants/limits';
import { generateSessionToken } from '../share-token';
import { renderGalleryPage, renderUnavailablePage } from '../guest-page-html';
import { findGalleryEvent, galleryPhotoPaths, listGallerySessions, verifyGalleryPassword, type GalleryEvent } from './gallery-repository';

const GALLERY_PATH = /^\/g\/([A-Za-z0-9_-]{22})(\/logo)?$/;
const GALLERY_API_PATH = /^\/api\/v1\/gallery\/([A-Za-z0-9_-]{22})$/;
const GALLERY_UNLOCK_PATH = /^\/api\/v1\/gallery\/([A-Za-z0-9_-]{22})\/unlock$/;
const GALLERY_PHOTO_PATH = /^\/api\/v1\/gallery\/([A-Za-z0-9_-]{22})\/photo\/([0-9a-f-]{36})$/i;
const MAX_UNLOCK_BODY_BYTES = 1_024;
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

/** Short-lived proof that a guest typed the gallery password; never derived from the password. */
export type GalleryGrants = Map<string, { token: string; expiresAt: number }>;

type GalleryContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  userDataPath: string;
  photosRoot: string;
  grants: GalleryGrants;
};

function grantIsValid(grants: GalleryGrants, token: string, request: IncomingMessage, url: URL): boolean {
  const grant = request.headers['x-gallery-grant'] ?? url.searchParams.get('grant');
  if (typeof grant !== 'string' || grant.length === 0) return false;
  const entry = grants.get(grant);
  if (!entry) return false;
  if (entry.token !== token || entry.expiresAt <= Date.now()) { grants.delete(grant); return false; }
  return true;
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UNLOCK_BODY_BYTES) { request.destroy(); resolve(null); return; }
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      try { const parsed: unknown = JSON.parse(body || '{}'); resolve(parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null); }
      catch { resolve(null); }
    });
    request.on('error', () => resolve(null));
  });
}

function galleryPayload(userDataPath: string, event: GalleryEvent): string {
  const sessions = listGallerySessions(userDataPath, event.id).map((session, index, all) => ({
    id: session.sessionId,
    // Oldest first reads like a story; the label numbers sessions within this gallery only.
    label: `Session ${all.length - index} · ${new Date(session.createdAt).toLocaleDateString()}`,
    photos: session.photos,
    outputId: session.outputId,
  }));
  return JSON.stringify({ eventName: event.name, sessions });
}

function serveEventLogo(context: GalleryContext, event: GalleryEvent, photosRoot: string): void {
  const { response, request } = context;
  const eventAssetsRoot = path.resolve(path.dirname(path.dirname(photosRoot)), 'event-assets');
  const resolved = event.logoPath ? resolveInside(eventAssetsRoot, event.logoPath) : null;
  if (!resolved || !fs.existsSync(resolved)) { response.writeHead(404).end(); return; }
  const type = path.extname(resolved).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': fs.statSync(resolved).size, 'Content-Disposition': 'inline' });
  if (request.method === 'HEAD') { response.end(); return; }
  fs.createReadStream(resolved).pipe(response);
}

/**
 * Everything behind `/g/<token>`: the gallery page, its JSON listing, the password unlock
 * and the photo bytes. Returns false when the URL is not a gallery URL, so the caller can
 * keep routing.
 */
export async function handleGalleryRequest(context: GalleryContext): Promise<boolean> {
  const { request, response, url, userDataPath, photosRoot, grants } = context;
  const { pathname } = url;

  const pageMatch = GALLERY_PATH.exec(pathname);
  if (pageMatch) {
    const event = findGalleryEvent(userDataPath, pageMatch[1]!);
    if (!event) { response.writeHead(404, HTML_HEADERS).end(renderUnavailablePage({ reason: 'invalid' })); return true; }
    if (pageMatch[2]) { serveEventLogo(context, event, photosRoot); return true; }
    const html = renderGalleryPage({ token: pageMatch[1]!, eventName: event.name, logoPath: event.logoPath, primaryColor: event.primaryColor, accentColor: event.accentColor, passwordProtected: event.passwordHash !== null });
    response.writeHead(200, HTML_HEADERS).end(request.method === 'HEAD' ? undefined : html);
    return true;
  }

  const unlockMatch = GALLERY_UNLOCK_PATH.exec(pathname);
  if (unlockMatch) {
    if (request.method !== 'POST') { response.writeHead(405).end(); return true; }
    const event = findGalleryEvent(userDataPath, unlockMatch[1]!);
    if (!event) { response.writeHead(404, JSON_HEADERS).end('{"error":"not_found"}'); return true; }
    const body = await readJsonBody(request);
    if (!verifyGalleryPassword(event, body?.password)) { response.writeHead(401, JSON_HEADERS).end('{"error":"invalid_password"}'); return true; }
    const grant = generateSessionToken();
    grants.set(grant, { token: unlockMatch[1]!, expiresAt: Date.now() + GALLERY_GRANT_TTL_MS });
    for (const [key, value] of grants) if (value.expiresAt <= Date.now()) grants.delete(key);
    response.writeHead(200, JSON_HEADERS).end(JSON.stringify({ grant }));
    return true;
  }

  const listingMatch = GALLERY_API_PATH.exec(pathname);
  if (listingMatch) {
    const event = findGalleryEvent(userDataPath, listingMatch[1]!);
    if (!event) { response.writeHead(404, JSON_HEADERS).end('{"error":"not_found"}'); return true; }
    if (event.passwordHash !== null && !grantIsValid(grants, listingMatch[1]!, request, url)) { response.writeHead(401, JSON_HEADERS).end('{"error":"password_required"}'); return true; }
    response.writeHead(200, JSON_HEADERS).end(galleryPayload(userDataPath, event));
    return true;
  }

  const photoMatch = GALLERY_PHOTO_PATH.exec(pathname);
  if (photoMatch) {
    const event = findGalleryEvent(userDataPath, photoMatch[1]!);
    if (!event) { response.writeHead(404).end(); return true; }
    if (event.passwordHash !== null && !grantIsValid(grants, photoMatch[1]!, request, url)) { response.writeHead(401, JSON_HEADERS).end('{"error":"password_required"}'); return true; }
    const stored = galleryPhotoPaths(userDataPath, event.id, photoMatch[2]!);
    const filePath = [stored?.downloadPath, stored?.originalPath]
      .map((candidate) => (candidate ? resolveInside(photosRoot, candidate) : null))
      .find((candidate) => candidate !== null && fs.existsSync(candidate)) ?? null;
    if (!filePath) { response.writeHead(404).end(); return true; }
    response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': fs.statSync(filePath).size, 'Cache-Control': 'private, max-age=300' });
    if (request.method === 'HEAD') { response.end(); return true; }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
    return true;
  }

  return false;
}
