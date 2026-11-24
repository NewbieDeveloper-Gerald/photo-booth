import { openDatabase } from '../../storage/database/connection';
import { isEventId, isShareToken } from '../../../shared/validation/identifiers';
import { hashSecret, verifySecret } from '../../../shared/crypto/secret-hash';
import { generateSessionToken } from '../share-token';

export type GalleryEvent = {
  id: string;
  name: string;
  logoPath: string | null;
  primaryColor: string;
  accentColor: string;
  contactText: string;
  passwordHash: string | null;
};

export type GallerySession = {
  sessionId: string;
  createdAt: string;
  photos: Array<{ id: string; slotNumber: number }>;
  outputId: string | null;
};

/**
 * One gallery link per event. The token is created on demand and never changes afterwards,
 * so a link printed on a sign keeps working until the operator deletes the event.
 */
export function createEventGalleryLink(userDataPath: string, eventIdValue: unknown, baseUrlValue: unknown): { url: string; token: string; passwordProtected: boolean } {
  if (!isEventId(eventIdValue) || typeof baseUrlValue !== 'string') throw new Error('Invalid gallery-link request');
  let baseUrl: URL;
  try { baseUrl = new URL(baseUrlValue); } catch { throw new Error('Configure a valid HTTPS download URL first'); }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== '/') throw new Error('Download URL must be an HTTPS site origin');
  const database = openDatabase(userDataPath);
  try {
    const event = database.prepare('SELECT id, gallery_token AS galleryToken, gallery_password_hash AS passwordHash FROM events WHERE id = ?').get(eventIdValue) as
      { id: string; galleryToken: string | null; passwordHash: string | null } | undefined;
    if (!event) throw new Error('Event not found');
    const token = event.galleryToken ?? generateSessionToken();
    if (!event.galleryToken) database.prepare('UPDATE events SET gallery_token = ? WHERE id = ?').run(token, event.id);
    return { url: `${baseUrl.origin}/g/${token}`, token, passwordProtected: event.passwordHash !== null };
  } finally { database.close(); }
}

export function findGalleryEvent(userDataPath: string, token: unknown): GalleryEvent | null {
  if (!isShareToken(token)) return null;
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare(`SELECT id, name, logo_path AS logoPath, primary_color AS primaryColor, accent_color AS accentColor,
      contact_text AS contactText, gallery_password_hash AS passwordHash FROM events WHERE gallery_token = ?`).get(token) as GalleryEvent | undefined;
    return row ?? null;
  } finally { database.close(); }
}

/** Only sessions with at least one photo are listed, newest first. */
export function listGallerySessions(userDataPath: string, eventId: string): GallerySession[] {
  const database = openDatabase(userDataPath);
  try {
    const sessions = database.prepare(`SELECT s.id AS sessionId, s.created_at AS createdAt
      FROM sessions s WHERE s.event_id = ? AND s.status = 'completed' ORDER BY s.created_at DESC`).all(eventId) as Array<{ sessionId: string; createdAt: string }>;
    const photos = database.prepare(`SELECT sl.session_id AS sessionId, p.id, sl.slot_number AS slotNumber
      FROM sessions s JOIN slots sl ON sl.session_id = s.id JOIN photos p ON p.id = sl.current_photo_id
      WHERE s.event_id = ? ORDER BY sl.slot_number`).all(eventId) as Array<{ sessionId: string; id: string; slotNumber: number }>;
    const outputs = database.prepare(`SELECT session_id AS sessionId, id FROM outputs WHERE kind LIKE 'finished-%'`).all() as Array<{ sessionId: string; id: string }>;
    return sessions
      .map((session) => ({
        ...session,
        photos: photos.filter((photo) => photo.sessionId === session.sessionId).map(({ id, slotNumber }) => ({ id, slotNumber })),
        outputId: outputs.find((output) => output.sessionId === session.sessionId)?.id ?? null,
      }))
      .filter((session) => session.photos.length > 0);
  } finally { database.close(); }
}

export function verifyGalleryPassword(event: GalleryEvent, password: unknown): boolean {
  if (event.passwordHash === null) return true;
  if (typeof password !== 'string' || password.length === 0) return false;
  return verifySecret(password, event.passwordHash);
}

/** Saves or clears the gallery password; the hash never leaves the main process. */
export function setGalleryPassword(userDataPath: string, eventIdValue: unknown, password: unknown): boolean {
  if (!isEventId(eventIdValue)) throw new Error('Invalid event');
  if (password !== null && typeof password !== 'string') throw new Error('Invalid gallery password');
  if (typeof password === 'string' && (password.length < 4 || password.length > 64)) throw new Error('Gallery password must be 4 to 64 characters');
  const database = openDatabase(userDataPath);
  try {
    const changed = database.prepare('UPDATE events SET gallery_password_hash = ? WHERE id = ?')
      .run(password === null ? null : hashSecret(password), eventIdValue).changes;
    if (!changed) throw new Error('Event not found');
    return password !== null;
  } finally { database.close(); }
}

/** Resolves the guest copy (or the original for older sessions) of a gallery photo. */
export function galleryPhotoPaths(userDataPath: string, eventId: string, photoId: string): { downloadPath: string | null; originalPath: string } | null {
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare(`SELECT p.original_path AS originalPath, p.download_path AS downloadPath
      FROM photos p JOIN slots sl ON sl.id = p.slot_id JOIN sessions s ON s.id = sl.session_id
      WHERE p.id = ? AND s.event_id = ? AND p.photo_state = 'current' LIMIT 1`).get(photoId, eventId) as { originalPath: string; downloadPath: string | null } | undefined;
    return row ?? null;
  } finally { database.close(); }
}
