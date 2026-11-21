import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canRetake, isValidRetakeLimit } from '../core/retakes';
import { getLayoutPreset } from '../core/layouts';
import { generateSessionToken } from '../core/token';

export type ActiveEvent = { id: string; name: string; shots: number; retakeLimit: number; printEnabled: boolean; expiryDays: number; eventDate: string | null; logoPath: string | null; primaryColor: string; accentColor: string; welcomeText: string; thankYouText: string; defaultLayoutId: string };
export type EventSettings = Omit<ActiveEvent, 'retakeLimit' | 'printEnabled'>;
export type UnfinishedSession = { id: string; createdAt: string; capturedSlots: number; totalSlots: number; pendingRetakes: number };
export type SessionSlot = { slotNumber: number; status: 'empty' | 'captured'; photoId: string | null; previousPhotoId: string | null; pendingPhotoId: string | null; downloadReady: boolean; hasPrevious: boolean; pendingDownloadReady: boolean; width: number | null; height: number | null };
export type SessionRecord = { id: string; eventId: string; eventName: string; layoutId: string; status: string; retakesUsed: number; retakeLimit: number; slots: SessionSlot[] };
type StoragePaths = { photosDirectory: string; backupDirectory: string };

type EventRow = { id: string; name: string; shots: number; retake_limit: number; print_enabled: number; expiry_days: number };

function openDatabase(userDataPath: string): Database.Database {
  const database = new Database(path.join(userDataPath, 'photobooth.sqlite'));
  database.pragma('foreign_keys = ON');
  return database;
}

function getPaths(userDataPath: string): StoragePaths {
  const configPath = path.join(userDataPath, 'photobooth-paths.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<StoragePaths>;
  if (!config.photosDirectory || !config.backupDirectory) throw new Error('Photo and backup paths are not configured');
  return { photosDirectory: config.photosDirectory, backupDirectory: config.backupDirectory };
}

export function getConfiguredStoragePaths(userDataPath: string): StoragePaths { return getPaths(userDataPath); }

async function copyBackupVersion(paths: StoragePaths, eventId: string, sessionId: string, sourcePath: string): Promise<void> {
  const source = storedPhotoPath(paths, sourcePath);
  const folder = ensureInside(paths.backupDirectory, path.join(paths.backupDirectory, eventId, sessionId));
  const destination = ensureInside(paths.backupDirectory, path.join(folder, path.basename(source)));
  await fs.promises.mkdir(folder, { recursive: true });
  if (fs.existsSync(destination)) return;
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await fs.promises.copyFile(source, temporaryPath);
  await fs.promises.rename(temporaryPath, destination);
}

function ensureInside(parent: string, child: string): string {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (!resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) throw new Error('Invalid photo path');
  return resolvedChild;
}

function storedPhotoPath(paths: StoragePaths, filePath: string): string {
  try { return ensureInside(paths.photosDirectory, filePath); }
  catch { return ensureInside(paths.backupDirectory, filePath); }
}

async function writeAtomically(filePath: string, bytes: Uint8Array): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temporaryPath, bytes, { flag: 'wx' });
  await fs.promises.rename(temporaryPath, filePath);
}

async function moveWithinPhotos(paths: StoragePaths, sourcePath: string, destinationPath: string): Promise<void> {
  const source = storedPhotoPath(paths, sourcePath);
  const destination = ensureInside(paths.photosDirectory, destinationPath);
  if (source === destination) return;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) throw new Error(`Photo version already exists: ${path.basename(destination)}`);
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await fs.promises.copyFile(source, temporaryPath);
  await fs.promises.rename(temporaryPath, destination);
}

function toBuffer(data: unknown): Buffer {
  if (!(data instanceof Uint8Array) || data.byteLength < 4 || data.byteLength > 100 * 1024 * 1024) {
    throw new Error('Invalid photo data');
  }
  return Buffer.from(data);
}

const DEFAULTS_BY_SHOTS: Record<number, string> = { 2: 'double-strip-2', 3: 'double-strip-3', 4: 'double-strip-4' };
function validateEventSettings(value: unknown): Omit<EventSettings, 'id' | 'logoPath'> {
  if (!value || typeof value !== 'object') throw new Error('Invalid event details');
  const item = value as Record<string, unknown>;
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 80) throw new Error('Event name is required (80 characters maximum)');
  const shots = item.shots;
  if (typeof shots !== 'number' || !Object.hasOwn(DEFAULTS_BY_SHOTS, shots)) throw new Error('Choose a shot count supported by the current layouts');
  const eventDate = item.eventDate === '' || item.eventDate === null ? null : item.eventDate;
  if (eventDate !== null && (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`)) || new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate)) throw new Error('Enter a valid event date');
  for (const key of ['primaryColor', 'accentColor'] as const) if (typeof item[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(item[key])) throw new Error(`${key === 'primaryColor' ? 'Primary' : 'Accent'} color must be a six-digit hex color`);
  for (const key of ['welcomeText', 'thankYouText'] as const) if (typeof item[key] !== 'string' || item[key].trim().length > 160) throw new Error(`${key === 'welcomeText' ? 'Welcome' : 'Thank-you'} text must be 160 characters or fewer`);
  const expiryDays = item.expiryDays;
  if (typeof expiryDays !== 'number' || !Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 365) throw new Error('QR link expiry must be from 1 to 365 days');
  return { name: item.name.trim(), shots, expiryDays, eventDate: eventDate as string | null, primaryColor: item.primaryColor as string, accentColor: item.accentColor as string,
    welcomeText: (item.welcomeText as string).trim(), thankYouText: (item.thankYouText as string).trim(), defaultLayoutId: DEFAULTS_BY_SHOTS[shots]! };
}

export function listEvents(userDataPath: string): EventSettings[] {
  const database = openDatabase(userDataPath);
  try { return database.prepare(`SELECT id, name, shots, expiry_days AS expiryDays, event_date AS eventDate, logo_path AS logoPath,
    primary_color AS primaryColor, accent_color AS accentColor, welcome_text AS welcomeText, thank_you_text AS thankYouText,
    default_layout_id AS defaultLayoutId FROM events ORDER BY name COLLATE NOCASE`).all() as EventSettings[]; }
  finally { database.close(); }
}

export function saveEventSettings(userDataPath: string, input: unknown): EventSettings {
  if (!input || typeof input !== 'object') throw new Error('Invalid event details');
  const item = input as Record<string, unknown>;
  const fields = validateEventSettings(input);
  const id = typeof item.id === 'string' && item.id ? item.id : randomUUID();
  const database = openDatabase(userDataPath);
  try {
    const exists = database.prepare('SELECT 1 FROM events WHERE id = ?').get(id);
    if (item.id && !exists) throw new Error('Event not found');
    if (exists) database.prepare(`UPDATE events SET name = ?, shots = ?, expiry_days = ?, event_date = ?, primary_color = ?, accent_color = ?,
      welcome_text = ?, thank_you_text = ?, default_layout_id = ? WHERE id = ?`).run(fields.name, fields.shots, fields.expiryDays, fields.eventDate,
      fields.primaryColor, fields.accentColor, fields.welcomeText, fields.thankYouText, fields.defaultLayoutId, id);
    else database.prepare(`INSERT INTO events (id, name, shots, retake_limit, print_enabled, expiry_days, event_date, primary_color, accent_color,
      welcome_text, thank_you_text, default_layout_id) VALUES (?, ?, ?, 3, 1, ?, ?, ?, ?, ?, ?, ?)`).run(id, fields.name, fields.shots, fields.expiryDays,
      fields.eventDate, fields.primaryColor, fields.accentColor, fields.welcomeText, fields.thankYouText, fields.defaultLayoutId);
    return database.prepare(`SELECT id, name, shots, expiry_days AS expiryDays, event_date AS eventDate, logo_path AS logoPath,
      primary_color AS primaryColor, accent_color AS accentColor, welcome_text AS welcomeText, thank_you_text AS thankYouText,
      default_layout_id AS defaultLayoutId FROM events WHERE id = ?`).get(id) as EventSettings;
  } finally { database.close(); }
}

export function selectActiveEvent(userDataPath: string, eventId: unknown): ActiveEvent {
  if (typeof eventId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(eventId)) throw new Error('Invalid event');
  const database = openDatabase(userDataPath);
  try {
    if (!database.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) throw new Error('Event not found');
    database.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('activeEventId', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(eventId);
  } finally { database.close(); }
  return getActiveEvent(userDataPath);
}

export function duplicateEvent(userDataPath: string, eventId: unknown): EventSettings {
  if (typeof eventId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(eventId)) throw new Error('Invalid event');
  const database = openDatabase(userDataPath);
  let source: EventSettings | undefined;
  try { source = database.prepare(`SELECT id, name, shots, expiry_days AS expiryDays, event_date AS eventDate, logo_path AS logoPath,
    primary_color AS primaryColor, accent_color AS accentColor, welcome_text AS welcomeText, thank_you_text AS thankYouText,
    default_layout_id AS defaultLayoutId FROM events WHERE id = ?`).get(eventId) as EventSettings | undefined; }
  finally { database.close(); }
  if (!source) throw new Error('Event not found');
  const copy = saveEventSettings(userDataPath, { ...source, id: undefined, name: `${source.name} Copy` });
  if (source.logoPath && fs.existsSync(source.logoPath)) {
    const copied = storeEventLogoPath(userDataPath, copy.id, source.logoPath);
    const update = openDatabase(userDataPath);
    try { update.prepare('UPDATE events SET logo_path = ? WHERE id = ?').run(copied, copy.id); }
    finally { update.close(); }
    return { ...copy, logoPath: copied };
  }
  return copy;
}

function eventAssetsPath(userDataPath: string, eventId: string): string {
  return ensureInside(userDataPath, path.join(userDataPath, 'event-assets', eventId));
}
function storeEventLogoPath(userDataPath: string, eventId: string, sourcePath: string): string {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) throw new Error('Choose a PNG or JPEG logo');
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile() || stats.size < 12 || stats.size > 5 * 1024 * 1024) throw new Error('Logo must be an image file no larger than 5 MB');
  const data = fs.readFileSync(sourcePath);
  const valid = ext === '.png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!valid) throw new Error('Logo contents do not match a supported PNG or JPEG file');
  const dir = eventAssetsPath(userDataPath, eventId);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `logo${ext}`);
  fs.copyFileSync(sourcePath, target);
  return target;
}

export function setEventLogo(userDataPath: string, eventId: unknown, sourcePath: unknown): string {
  if (typeof eventId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(eventId) || typeof sourcePath !== 'string') throw new Error('Invalid logo request');
  const db = openDatabase(userDataPath);
  try { if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) throw new Error('Event not found'); }
  finally { db.close(); }
  const logoPath = storeEventLogoPath(userDataPath, eventId, sourcePath);
  const update = openDatabase(userDataPath);
  try { update.prepare('UPDATE events SET logo_path = ? WHERE id = ?').run(logoPath, eventId); }
  finally { update.close(); }
  return logoPath;
}

export function getEventLogoDataUrl(userDataPath: string, eventId: unknown): string | null {
  if (typeof eventId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(eventId)) return null;
  const db = openDatabase(userDataPath);
  let logoPath: string | null;
  try { logoPath = (db.prepare('SELECT logo_path FROM events WHERE id = ?').get(eventId) as { logo_path: string | null } | undefined)?.logo_path ?? null; }
  finally { db.close(); }
  if (!logoPath || !fs.existsSync(logoPath)) return null;
  const ext = path.extname(logoPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;
  return `data:${ext === '.png' ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(logoPath).toString('base64')}`;
}

export function getActiveEvent(userDataPath: string): ActiveEvent {
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare(`SELECT e.id, e.name, e.shots, e.retake_limit, e.print_enabled, e.expiry_days,
      e.event_date AS eventDate, e.logo_path AS logoPath, e.primary_color AS primaryColor, e.accent_color AS accentColor,
      e.welcome_text AS welcomeText, e.thank_you_text AS thankYouText, e.default_layout_id AS defaultLayoutId
      FROM events e JOIN settings s ON s.key = 'activeEventId' AND s.value = e.id LIMIT 1`).get() as (EventRow & {
        eventDate: string | null; logoPath: string | null; primaryColor: string; accentColor: string;
        welcomeText: string; thankYouText: string; defaultLayoutId: string;
      }) | undefined;
    if (!row) throw new Error('No active event is configured');
    return { id: row.id, name: row.name, shots: row.shots, retakeLimit: row.retake_limit, printEnabled: Boolean(row.print_enabled), expiryDays: row.expiry_days,
      eventDate: row.eventDate, logoPath: row.logoPath, primaryColor: row.primaryColor, accentColor: row.accentColor,
      welcomeText: row.welcomeText, thankYouText: row.thankYouText, defaultLayoutId: row.defaultLayoutId };
  } finally {
    database.close();
  }
}

export function setActiveEventRetakeLimit(userDataPath: string, limit: unknown): ActiveEvent {
  if (typeof limit !== 'number' || !isValidRetakeLimit(limit)) throw new Error('Retake limit must be a nonnegative whole number, or unlimited');
  const database = openDatabase(userDataPath);
  try {
    const activeEventId = database.prepare("SELECT value FROM settings WHERE key = 'activeEventId'").get() as { value: string } | undefined;
    if (!activeEventId) throw new Error('No active event is configured');
    database.prepare('UPDATE events SET retake_limit = ? WHERE id = ?').run(limit, activeEventId.value);
  } finally {
    database.close();
  }
  return getActiveEvent(userDataPath);
}

export function createSession(userDataPath: string, layoutIdValue: unknown = 'double-strip-3'): { sessionId: string; event: ActiveEvent; shots: number; layoutId: string } {
  const event = getActiveEvent(userDataPath);
  const layout = getLayoutPreset(layoutIdValue);
  if (layout.shots !== event.shots) throw new Error('Selected layout does not match the active event shot count');
  const sessionId = randomUUID();
  const database = openDatabase(userDataPath);
  try {
    database.transaction(() => {
      database.prepare('INSERT INTO sessions (id, event_id, status, retake_limit, layout_id) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, event.id, 'in_progress', event.retakeLimit, layout.id);
      const insertSlot = database.prepare('INSERT INTO slots (id, session_id, slot_number, status) VALUES (?, ?, ?, ?)');
      for (let slot = 1; slot <= layout.shots; slot += 1) insertSlot.run(randomUUID(), sessionId, slot, 'empty');
    })();
    return { sessionId, event, shots: layout.shots, layoutId: layout.id };
  } finally {
    database.close();
  }
}

export function listUnfinishedSessions(userDataPath: string): UnfinishedSession[] {
  const database = openDatabase(userDataPath);
  try {
    return database.prepare(`SELECT s.id, s.created_at AS createdAt,
      SUM(CASE WHEN sl.status = 'captured' THEN 1 ELSE 0 END) AS capturedSlots,
      COUNT(sl.id) AS totalSlots,
      (SELECT COUNT(*) FROM photos p JOIN slots pending_slot ON pending_slot.id = p.slot_id
        WHERE pending_slot.session_id = s.id AND p.photo_state = 'pending') AS pendingRetakes
      FROM sessions s JOIN slots sl ON sl.session_id = s.id
      WHERE s.status = 'in_progress' OR EXISTS (
        SELECT 1 FROM photos p JOIN slots pending_slot ON pending_slot.id = p.slot_id
        WHERE pending_slot.session_id = s.id AND p.photo_state = 'pending'
      ) GROUP BY s.id ORDER BY s.created_at DESC`).all() as UnfinishedSession[];
  } finally {
    database.close();
  }
}

export function loadSession(userDataPath: string, sessionId: unknown): SessionRecord {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Invalid session id');
  const database = openDatabase(userDataPath);
  try {
    const session = database.prepare(`SELECT s.id, s.event_id AS eventId, e.name AS eventName, s.status,
      s.retakes_used AS retakesUsed, s.retake_limit AS retakeLimit, s.layout_id AS layoutId
      FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = ?`).get(sessionId) as Omit<SessionRecord, 'slots'> | undefined;
    if (!session) throw new Error('Session not found');
    const slots = database.prepare(`SELECT sl.slot_number AS slotNumber, sl.status,
      current.id AS photoId, current.download_path AS downloadPath, current.width, current.height,
      previous.id AS previousPhotoId, pending.id AS pendingPhotoId, pending.download_path AS pendingDownloadPath
      FROM slots sl
      LEFT JOIN photos current ON current.id = sl.current_photo_id
      LEFT JOIN photos previous ON previous.id = sl.previous_photo_id
      LEFT JOIN photos pending ON pending.slot_id = sl.id AND pending.photo_state = 'pending'
      WHERE sl.session_id = ? ORDER BY sl.slot_number`).all(sessionId) as Array<{
        slotNumber: number; status: 'empty' | 'captured'; photoId: string | null; downloadPath: string | null;
        previousPhotoId: string | null; pendingPhotoId: string | null; pendingDownloadPath: string | null; width: number | null; height: number | null;
      }>;
    return { ...session, slots: slots.map(({ downloadPath, previousPhotoId, pendingDownloadPath, ...slot }) => ({
      ...slot, previousPhotoId, hasPrevious: Boolean(previousPhotoId), downloadReady: Boolean(downloadPath),
      pendingDownloadReady: Boolean(pendingDownloadPath),
    })) };
  } finally {
    database.close();
  }
}

export async function saveOriginalPhoto(
  userDataPath: string,
  sessionId: unknown,
  slotNumber: unknown,
  data: unknown,
  width: unknown,
  height: unknown,
): Promise<{ photoId: string; width: number; height: number }> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId) || !Number.isInteger(slotNumber) ||
      !Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1 ||
      (width as number) > 20000 || (height as number) > 20000) throw new Error('Invalid capture details');
  const bytes = toBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getPaths(userDataPath);
  let slot: { id: string; event_id: string } | undefined;
  try {
    slot = database.prepare(`SELECT sl.id, s.event_id FROM slots sl JOIN sessions s ON s.id = sl.session_id
      WHERE sl.session_id = ? AND sl.slot_number = ? AND sl.status = 'empty' AND s.status = 'in_progress'`).get(sessionId, slotNumber) as typeof slot;
  } finally {
    database.close();
  }
  if (!slot) throw new Error('This session slot is not available for capture');

  const photoId = randomUUID();
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, slot.event_id, sessionId));
  const originalPath = ensureInside(paths.photosDirectory, path.join(folder, `slot-${String(slotNumber).padStart(2, '0')}-original.jpg`));
  await writeAtomically(originalPath, bytes);
  await copyBackupVersion(paths, slot.event_id, sessionId, originalPath);

  const recordDatabase = openDatabase(userDataPath);
  try {
    recordDatabase.transaction(() => {
      const current = recordDatabase.prepare("SELECT status FROM slots WHERE id = ?").get(slot!.id) as { status: string } | undefined;
      if (!current || current.status !== 'empty') throw new Error('This slot was already captured');
      recordDatabase.prepare("INSERT INTO photos (id, slot_id, original_path, width, height, photo_state) VALUES (?, ?, ?, ?, ?, 'current')")
        .run(photoId, slot!.id, originalPath, width, height);
      recordDatabase.prepare("UPDATE slots SET status = 'captured', current_photo_id = ?, captured_at = datetime('now') WHERE id = ?")
        .run(photoId, slot!.id);
      const readiness = recordDatabase.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN current_photo_id IS NOT NULL THEN 1 ELSE 0 END) AS ready FROM slots WHERE session_id = ?`).get(sessionId) as { total: number; ready: number };
      if (readiness.total > 0 && readiness.ready === readiness.total) {
        recordDatabase.prepare("UPDATE sessions SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status = 'in_progress'").run(sessionId);
      } else recordDatabase.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
    })();
  } finally {
    recordDatabase.close();
  }
  return { photoId, width: width as number, height: height as number };
}

export async function saveRetakeOriginalPhoto(
  userDataPath: string,
  sessionId: unknown,
  slotNumber: unknown,
  data: unknown,
  width: unknown,
  height: unknown,
): Promise<{ photoId: string; width: number; height: number }> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId) || !Number.isInteger(slotNumber) ||
      !Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1 ||
      (width as number) > 20000 || (height as number) > 20000) throw new Error('Invalid retake details');
  const bytes = toBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getPaths(userDataPath);
  let slot: { id: string; event_id: string } | undefined;
  try {
    slot = database.prepare(`SELECT sl.id, s.event_id FROM slots sl JOIN sessions s ON s.id = sl.session_id
      WHERE sl.session_id = ? AND sl.slot_number = ? AND sl.current_photo_id IS NOT NULL
        AND s.status = 'completed' AND (s.retake_limit = -1 OR s.retakes_used < s.retake_limit)
        AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.slot_id = sl.id AND p.photo_state = 'pending')`).get(sessionId, slotNumber) as typeof slot;
  } finally {
    database.close();
  }
  if (!slot) throw new Error('This slot cannot be retaken or the session limit has been reached');

  const photoId = randomUUID();
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, slot.event_id, sessionId));
  const originalPath = ensureInside(paths.photosDirectory, path.join(folder, `slot-${slotNumber}-${photoId}.jpg`));
  await writeAtomically(originalPath, bytes);

  const recordDatabase = openDatabase(userDataPath);
  try {
    recordDatabase.transaction(() => {
      const current = recordDatabase.prepare(`SELECT s.retake_limit, s.retakes_used FROM slots sl
        JOIN sessions s ON s.id = sl.session_id WHERE sl.id = ? AND s.status = 'completed'`).get(slot!.id) as { retake_limit: number; retakes_used: number } | undefined;
      if (!current || !canRetake(current.retake_limit, current.retakes_used)) throw new Error('The session retake limit has been reached');
      recordDatabase.prepare("INSERT INTO photos (id, slot_id, original_path, width, height, photo_state) VALUES (?, ?, ?, ?, ?, 'pending')")
        .run(photoId, slot!.id, originalPath, width, height);
    })();
  } finally {
    recordDatabase.close();
  }
  return { photoId, width: width as number, height: height as number };
}

export async function commitRetake(userDataPath: string, sessionId: unknown, slotNumber: unknown, newPhotoId: unknown): Promise<void> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId) || !Number.isInteger(slotNumber) ||
      typeof newPhotoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(newPhotoId)) throw new Error('Invalid retake request');
  const database = openDatabase(userDataPath);
  const paths = getPaths(userDataPath);
  let row: { slot_id: string; event_id: string; current_id: string; previous_id: string | null; retake_limit: number; used: number;
    old_original: string; old_download: string | null; pending_download: string | null; previous_original: string | null } | undefined;
  try {
    row = database.prepare(`SELECT sl.id AS slot_id, s.event_id, sl.current_photo_id AS current_id,
      sl.previous_photo_id AS previous_id, s.retake_limit, s.retakes_used AS used,
      current.original_path AS old_original, current.download_path AS old_download,
      pending.download_path AS pending_download, previous.original_path AS previous_original
      FROM slots sl JOIN sessions s ON s.id = sl.session_id
      JOIN photos current ON current.id = sl.current_photo_id
      JOIN photos pending ON pending.id = ? AND pending.slot_id = sl.id AND pending.photo_state = 'pending'
      LEFT JOIN photos previous ON previous.id = sl.previous_photo_id
      WHERE s.id = ? AND sl.slot_number = ? AND s.status = 'completed'`).get(newPhotoId, sessionId, slotNumber) as typeof row;
  } finally {
    database.close();
  }
  if (!row || !canRetake(row.retake_limit, row.used)) throw new Error('Retake is incomplete or the session limit has been reached');

  const oldOriginal = storedPhotoPath(paths, row.old_original);
  const oldDownload = row.old_download ? storedPhotoPath(paths, row.old_download) : null;
  const pendingRow = openDatabase(userDataPath);
  let versionNumber: number;
  let slotNo: number;
  try {
    const meta = pendingRow.prepare(`SELECT sl.slot_number AS slotNo,
      (SELECT COUNT(*) FROM photos p WHERE p.slot_id = sl.id AND p.photo_state != 'pending') AS versions
      FROM slots sl WHERE sl.id = ?`).get(row.slot_id) as { slotNo: number; versions: number };
    slotNo = meta.slotNo;
    versionNumber = meta.versions;
  } finally { pendingRow.close(); }
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, row.event_id, sessionId));
  const currentVersion = row.previous_id ? `slot-${String(slotNo).padStart(2, '0')}-retake-${String(versionNumber - 1).padStart(2, '0')}` : `slot-${String(slotNo).padStart(2, '0')}-original`;
  const nextVersion = `slot-${String(slotNo).padStart(2, '0')}-retake-${String(versionNumber).padStart(2, '0')}`;
  const keptOriginal = path.join(folder, `${currentVersion}.jpg`);
  const keptDownload = oldDownload ? path.join(folder, `${currentVersion}-download.jpg`) : null;
  const pendingDatabase = openDatabase(userDataPath);
  let pendingOriginal: string;
  let pendingDownload: string | null;
  try {
    const pendingPaths = pendingDatabase.prepare('SELECT original_path, download_path FROM photos WHERE id = ?').get(newPhotoId) as { original_path: string; download_path: string | null };
    pendingOriginal = pendingPaths.original_path;
    pendingDownload = pendingPaths.download_path;
  } finally { pendingDatabase.close(); }

  // Preserve every version alongside the session. Copy first so a crash never destroys the DB-referenced source.
  await moveWithinPhotos(paths, oldOriginal, keptOriginal);
  if (oldDownload && keptDownload) await moveWithinPhotos(paths, oldDownload, keptDownload);
  const newOriginal = path.join(folder, `${nextVersion}.jpg`);
  const newDownload = pendingDownload ? path.join(folder, `${nextVersion}-download.jpg`) : null;
  await moveWithinPhotos(paths, pendingOriginal, newOriginal);
  if (pendingDownload && newDownload) await moveWithinPhotos(paths, pendingDownload, newDownload);
  await copyBackupVersion(paths, row.event_id, sessionId, keptOriginal);
  await copyBackupVersion(paths, row.event_id, sessionId, newOriginal);

  const update = openDatabase(userDataPath);
  try {
    update.transaction(() => {
      if (row!.previous_id) update.prepare("UPDATE photos SET photo_state = 'archived' WHERE id = ?").run(row!.previous_id);
      update.prepare("UPDATE photos SET original_path = ?, download_path = ?, photo_state = 'previous' WHERE id = ?")
        .run(keptOriginal, keptDownload, row!.current_id);
      update.prepare("UPDATE photos SET original_path = ?, download_path = ?, photo_state = 'current' WHERE id = ? AND photo_state = 'pending'")
        .run(newOriginal, newDownload, newPhotoId);
      update.prepare('UPDATE slots SET previous_photo_id = current_photo_id, current_photo_id = ? WHERE id = ?').run(newPhotoId, row!.slot_id);
      update.prepare('UPDATE sessions SET retakes_used = retakes_used + 1, updated_at = datetime(\'now\') WHERE id = ?').run(sessionId);
    })();
  } finally { update.close(); }
  const photosRoot = `${path.resolve(paths.photosDirectory)}${path.sep}`;
  for (const obsolete of [oldOriginal, oldDownload, pendingOriginal, pendingDownload]) {
    if (obsolete && path.resolve(obsolete).startsWith(photosRoot) &&
        ![keptOriginal, keptDownload, newOriginal, newDownload].includes(obsolete)) {
      await fs.promises.rm(obsolete, { force: true });
    }
  }
}

export async function revertRetake(userDataPath: string, sessionId: unknown, slotNumber: unknown): Promise<void> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId) || !Number.isInteger(slotNumber)) throw new Error('Invalid revert request');
  const database = openDatabase(userDataPath);
  let row: { slot_id: string; event_id: string; current_id: string; previous_id: string; current_original: string; current_download: string | null;
    previous_original: string; previous_download: string | null } | undefined;
  try {
    row = database.prepare(`SELECT sl.id AS slot_id, s.event_id, current.id AS current_id, previous.id AS previous_id,
      current.original_path AS current_original, current.download_path AS current_download,
      previous.original_path AS previous_original, previous.download_path AS previous_download
      FROM slots sl JOIN sessions s ON s.id = sl.session_id
      JOIN photos current ON current.id = sl.current_photo_id
      JOIN photos previous ON previous.id = sl.previous_photo_id
      WHERE s.id = ? AND sl.slot_number = ? AND s.status = 'completed'`).get(sessionId, slotNumber) as typeof row;
  } finally {
    database.close();
  }
  if (!row) throw new Error('There is no previous photo to restore for this slot');

  // Versions remain in the session folder; reverting only changes the current/previous pointers.
  const update = openDatabase(userDataPath);
  try {
    update.transaction(() => {
      update.prepare("UPDATE photos SET photo_state = 'archived' WHERE id = ?").run(row!.current_id);
      update.prepare("UPDATE photos SET photo_state = 'current' WHERE id = ?").run(row!.previous_id);
      update.prepare('UPDATE slots SET current_photo_id = previous_photo_id, previous_photo_id = NULL WHERE id = ?').run(row!.slot_id);
      update.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
    })();
  } finally { update.close(); }
}

export async function saveSessionOutput(userDataPath: string, sessionIdValue: unknown, data: unknown, widthValue: unknown, heightValue: unknown): Promise<string> {
  if (typeof sessionIdValue !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionIdValue) ||
      !Number.isInteger(widthValue) || !Number.isInteger(heightValue)) throw new Error('Invalid finished image details');
  const bytes = toBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getPaths(userDataPath);
  let session: { event_id: string; layout_id: string } | undefined;
  try { session = database.prepare("SELECT event_id, layout_id FROM sessions WHERE id = ? AND status = 'completed'").get(sessionIdValue) as typeof session; }
  finally { database.close(); }
  if (!session) throw new Error('Only completed sessions can save a finished image');
  const layout = getLayoutPreset(session.layout_id);
  if (widthValue !== layout.width || heightValue !== layout.height) throw new Error(`Finished image must be ${layout.width} by ${layout.height} pixels`);
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, session.event_id, sessionIdValue));
  const outputPath = ensureInside(folder, path.join(folder, `finished-${session.layout_id}-${randomUUID()}.jpg`));
  await writeAtomically(outputPath, bytes);
  const outputDatabase = openDatabase(userDataPath);
  try { outputDatabase.prepare('INSERT INTO outputs (id, session_id, output_path, kind) VALUES (?, ?, ?, ?)').run(randomUUID(), sessionIdValue, outputPath, `finished-${session.layout_id}`); }
  finally { outputDatabase.close(); }
  return outputPath;
}

export function createSessionShareLink(userDataPath: string, sessionIdValue: unknown, baseUrlValue: unknown): { url: string; expiresAt: string } {
  if (typeof sessionIdValue !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionIdValue) || typeof baseUrlValue !== 'string') throw new Error('Invalid share-link request');
  let baseUrl: URL;
  try { baseUrl = new URL(baseUrlValue); } catch { throw new Error('Configure a valid HTTPS download URL first'); }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== '/') throw new Error('Download URL must be an HTTPS site origin');
  const database = openDatabase(userDataPath);
  try {
    const session = database.prepare(`SELECT s.status, e.expiry_days FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = ?`).get(sessionIdValue) as { status: string; expiry_days: number } | undefined;
    if (!session || session.status !== 'completed') throw new Error('Only completed sessions can be shared');
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + session.expiry_days * 24 * 60 * 60 * 1000).toISOString();
    database.prepare("UPDATE sessions SET public_token = ?, token_expires_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(token, expiresAt, sessionIdValue);
    return { url: `${baseUrl.origin}/d/${token}`, expiresAt };
  } finally { database.close(); }
}

export function getLatestSessionPrintInfo(userDataPath: string, sessionIdValue: unknown): { imagePath: string; width: number; height: number } {
  if (typeof sessionIdValue !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionIdValue)) throw new Error('Invalid session id');
  const database = openDatabase(userDataPath);
  const paths = getPaths(userDataPath);
  try {
    const row = database.prepare(`SELECT o.output_path AS imagePath, s.layout_id AS layoutId
      FROM outputs o JOIN sessions s ON s.id = o.session_id
      WHERE o.session_id = ? AND o.kind LIKE 'finished-%'
      ORDER BY o.created_at DESC, o.rowid DESC LIMIT 1`).get(sessionIdValue) as { imagePath: string; layoutId: string } | undefined;
    if (!row) throw new Error('No finished layout is saved for this session');
    const layout = getLayoutPreset(row.layoutId);
    return { imagePath: ensureInside(paths.photosDirectory, row.imagePath), width: layout.width, height: layout.height };
  } finally { database.close(); }
}

export async function saveDownloadCopy(userDataPath: string, photoId: unknown, data: unknown): Promise<void> {
  if (typeof photoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(photoId)) throw new Error('Invalid photo id');
  const bytes = toBuffer(data);
  const database = openDatabase(userDataPath);
  let row: { original_path: string; session_id: string; photo_state: string } | undefined;
  const paths = getPaths(userDataPath);
  try {
    row = database.prepare(`SELECT p.original_path, p.photo_state, s.id AS session_id
      FROM photos p JOIN slots sl ON sl.id = p.slot_id JOIN sessions s ON s.id = sl.session_id
      WHERE p.id = ? AND s.status IN ('in_progress', 'completed') AND p.photo_state IN ('current', 'pending')`).get(photoId) as typeof row;
  } finally {
    database.close();
  }
  if (!row) throw new Error('Photo is not part of an active session');
  const originalPath = ensureInside(paths.photosDirectory, row.original_path);
  const downloadPath = ensureInside(paths.photosDirectory, `${originalPath.slice(0, -4)}-download.jpg`);
  await writeAtomically(downloadPath, bytes);

  const updateDatabase = openDatabase(userDataPath);
  try {
    updateDatabase.transaction(() => {
      updateDatabase.prepare('UPDATE photos SET download_path = ? WHERE id = ?').run(downloadPath, photoId);
      const readiness = updateDatabase.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN current.download_path IS NOT NULL THEN 1 ELSE 0 END) AS ready
        FROM slots sl LEFT JOIN photos current ON current.id = sl.current_photo_id WHERE sl.session_id = ?`).get(row!.session_id) as { total: number; ready: number | null };
      if (readiness.total > 0 && readiness.ready === readiness.total) {
        updateDatabase.prepare("UPDATE sessions SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status = 'in_progress'").run(row!.session_id);
      } else {
        updateDatabase.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(row!.session_id);
      }
    })();
  } finally {
    updateDatabase.close();
  }
}

export function readOriginalPhoto(userDataPath: string, photoId: unknown): Uint8Array {
  if (typeof photoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(photoId)) throw new Error('Invalid photo id');
  const database = openDatabase(userDataPath);
  const paths = getPaths(userDataPath);
  try {
    const row = database.prepare('SELECT original_path FROM photos WHERE id = ?').get(photoId) as { original_path: string } | undefined;
    if (!row) throw new Error('Photo not found');
    const originalPath = storedPhotoPath(paths, row.original_path);
    return new Uint8Array(fs.readFileSync(originalPath));
  } finally {
    database.close();
  }
}

export async function exportEventFolder(userDataPath: string, eventIdValue: unknown, destinationRootValue: unknown): Promise<string> {
  if (typeof eventIdValue !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(eventIdValue) || typeof destinationRootValue !== 'string') throw new Error('Invalid export request');
  const paths = getPaths(userDataPath);
  const database = openDatabase(userDataPath);
  let event: { id: string; name: string } | undefined;
  try { event = database.prepare('SELECT id, name FROM events WHERE id = ?').get(eventIdValue) as typeof event; }
  finally { database.close(); }
  if (!event) throw new Error('Event not found');
  const destinationRoot = path.resolve(destinationRootValue);
  const overlaps = (first: string, second: string): boolean => {
    const a = path.resolve(first); const b = path.resolve(second);
    return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
  };
  if (overlaps(destinationRoot, paths.photosDirectory) || overlaps(destinationRoot, paths.backupDirectory)) {
    throw new Error('Choose an export folder outside the booth photos and backup folders');
  }
  const photosSource = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, event.id));
  const backupSource = ensureInside(paths.backupDirectory, path.join(paths.backupDirectory, event.id));
  const photosTarget = path.join(destinationRoot, 'photos', event.id);
  const backupTarget = path.join(destinationRoot, 'backup', event.id);
  await fs.promises.mkdir(destinationRoot, { recursive: true });
  for (const [source, target] of [[photosSource, photosTarget], [backupSource, backupTarget]] as const) {
    if (fs.existsSync(source)) await fs.promises.cp(source, target, { recursive: true, force: true, errorOnExist: false });
  }
  // Ensure sessions created before automatic backups are protected too.
  if (fs.existsSync(photosSource)) {
    for (const sessionEntry of await fs.promises.readdir(photosSource, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;
      const sessionFolder = path.join(photosSource, sessionEntry.name);
      for (const file of await fs.promises.readdir(sessionFolder, { withFileTypes: true })) {
        if (file.isFile() && file.name.startsWith('slot-') && file.name.toLowerCase().endsWith('.jpg')) await copyBackupVersion(paths, event.id, sessionEntry.name, path.join(sessionFolder, file.name));
      }
    }
    await fs.promises.cp(backupSource, backupTarget, { recursive: true, force: true, errorOnExist: false }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  return destinationRoot;
}

async function copySessionOriginalsToBackup(userDataPath: string, sessionId: string, newStatus: 'abandoned' | 'discarded'): Promise<void> {
  const database = openDatabase(userDataPath);
  const paths = getPaths(userDataPath);
  try {
    const rows = database.prepare(`SELECT s.event_id, p.original_path FROM sessions s
      JOIN slots sl ON sl.session_id = s.id JOIN photos p ON p.slot_id = sl.id WHERE s.id = ?`).all(sessionId) as Array<{ event_id: string; original_path: string }>;
    const backupFolder = ensureInside(paths.backupDirectory, path.join(paths.backupDirectory, rows[0]?.event_id ?? 'unknown-event', sessionId));
    await fs.promises.mkdir(backupFolder, { recursive: true });
    for (const row of rows) {
      const source = storedPhotoPath(paths, row.original_path);
      const destination = ensureInside(paths.backupDirectory, path.join(backupFolder, path.basename(source)));
      if (source !== destination && !fs.existsSync(destination)) {
        const temporaryPath = `${destination}.${randomUUID()}.tmp`;
        await fs.promises.copyFile(source, temporaryPath);
        await fs.promises.rename(temporaryPath, destination);
      }
    }
    database.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('in_progress', 'completed')").run(newStatus, sessionId);
  } finally {
    database.close();
  }
}

export async function abandonSession(userDataPath: string, sessionId: unknown): Promise<void> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Invalid session id');
  await copySessionOriginalsToBackup(userDataPath, sessionId, 'abandoned');
}

export async function discardSession(userDataPath: string, sessionId: unknown): Promise<void> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Invalid session id');
  await copySessionOriginalsToBackup(userDataPath, sessionId, 'discarded');
}
