import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ActiveEvent = { id: string; name: string; shots: number; retakeLimit: number; printEnabled: boolean; expiryDays: number };
export type UnfinishedSession = { id: string; createdAt: string; capturedSlots: number; totalSlots: number };
export type SessionSlot = { slotNumber: number; status: 'empty' | 'captured'; photoId: string | null; downloadReady: boolean; width: number | null; height: number | null };
export type SessionRecord = { id: string; eventId: string; eventName: string; status: string; slots: SessionSlot[] };
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

function ensureInside(parent: string, child: string): string {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (!resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) throw new Error('Invalid photo path');
  return resolvedChild;
}

async function writeAtomically(filePath: string, bytes: Uint8Array): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temporaryPath, bytes, { flag: 'wx' });
  await fs.promises.rename(temporaryPath, filePath);
}

function toBuffer(data: unknown): Buffer {
  if (!(data instanceof Uint8Array) || data.byteLength < 4 || data.byteLength > 100 * 1024 * 1024) {
    throw new Error('Invalid photo data');
  }
  return Buffer.from(data);
}

export function getActiveEvent(userDataPath: string): ActiveEvent {
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare(`SELECT e.id, e.name, e.shots, e.retake_limit, e.print_enabled, e.expiry_days
      FROM events e JOIN settings s ON s.key = 'activeEventId' AND s.value = e.id LIMIT 1`).get() as EventRow | undefined;
    if (!row) throw new Error('No active event is configured');
    return { id: row.id, name: row.name, shots: row.shots, retakeLimit: row.retake_limit, printEnabled: Boolean(row.print_enabled), expiryDays: row.expiry_days };
  } finally {
    database.close();
  }
}

export function createSession(userDataPath: string): { sessionId: string; event: ActiveEvent } {
  const event = getActiveEvent(userDataPath);
  const sessionId = randomUUID();
  const database = openDatabase(userDataPath);
  try {
    database.transaction(() => {
      database.prepare('INSERT INTO sessions (id, event_id, status) VALUES (?, ?, ?)').run(sessionId, event.id, 'in_progress');
      const insertSlot = database.prepare('INSERT INTO slots (id, session_id, slot_number, status) VALUES (?, ?, ?, ?)');
      for (let slot = 1; slot <= event.shots; slot += 1) insertSlot.run(randomUUID(), sessionId, slot, 'empty');
    })();
    return { sessionId, event };
  } finally {
    database.close();
  }
}

export function listUnfinishedSessions(userDataPath: string): UnfinishedSession[] {
  const database = openDatabase(userDataPath);
  try {
    return database.prepare(`SELECT s.id, s.created_at AS createdAt,
      SUM(CASE WHEN sl.status = 'captured' THEN 1 ELSE 0 END) AS capturedSlots,
      COUNT(sl.id) AS totalSlots
      FROM sessions s JOIN slots sl ON sl.session_id = s.id
      WHERE s.status = 'in_progress' GROUP BY s.id ORDER BY s.created_at DESC`).all() as UnfinishedSession[];
  } finally {
    database.close();
  }
}

export function loadSession(userDataPath: string, sessionId: unknown): SessionRecord {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Invalid session id');
  const database = openDatabase(userDataPath);
  try {
    const session = database.prepare(`SELECT s.id, s.event_id AS eventId, e.name AS eventName, s.status
      FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = ?`).get(sessionId) as Omit<SessionRecord, 'slots'> | undefined;
    if (!session) throw new Error('Session not found');
    const slots = database.prepare(`SELECT sl.slot_number AS slotNumber, sl.status, p.id AS photoId,
      p.download_path AS downloadPath, p.width, p.height
      FROM slots sl LEFT JOIN photos p ON p.slot_id = sl.id
      WHERE sl.session_id = ? ORDER BY sl.slot_number`).all(sessionId) as Array<{
        slotNumber: number; status: 'empty' | 'captured'; photoId: string | null; downloadPath: string | null; width: number | null; height: number | null;
      }>;
    return { ...session, slots: slots.map(({ downloadPath, ...slot }) => ({ ...slot, downloadReady: Boolean(downloadPath) })) };
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
  const originalPath = ensureInside(paths.photosDirectory, path.join(folder, `slot-${slotNumber}-${photoId}.jpg`));
  await writeAtomically(originalPath, bytes);

  const recordDatabase = openDatabase(userDataPath);
  try {
    recordDatabase.transaction(() => {
      const current = recordDatabase.prepare("SELECT status FROM slots WHERE id = ?").get(slot!.id) as { status: string } | undefined;
      if (!current || current.status !== 'empty') throw new Error('This slot was already captured');
      recordDatabase.prepare('INSERT INTO photos (id, slot_id, original_path, width, height) VALUES (?, ?, ?, ?, ?)')
        .run(photoId, slot!.id, originalPath, width, height);
      recordDatabase.prepare("UPDATE slots SET status = 'captured', captured_at = datetime('now') WHERE id = ?").run(slot!.id);
      recordDatabase.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
    })();
  } finally {
    recordDatabase.close();
  }
  return { photoId, width: width as number, height: height as number };
}

export async function saveDownloadCopy(userDataPath: string, photoId: unknown, data: unknown): Promise<void> {
  if (typeof photoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(photoId)) throw new Error('Invalid photo id');
  const bytes = toBuffer(data);
  const database = openDatabase(userDataPath);
  let row: { original_path: string; session_id: string; slot_count: number; photo_count: number } | undefined;
  const paths = getPaths(userDataPath);
  try {
    row = database.prepare(`SELECT p.original_path, s.id AS session_id,
      (SELECT COUNT(*) FROM slots WHERE session_id = s.id) AS slot_count,
      (SELECT COUNT(*) FROM photos pp JOIN slots ss ON ss.id = pp.slot_id WHERE ss.session_id = s.id AND pp.download_path IS NOT NULL) AS photo_count
      FROM photos p JOIN slots sl ON sl.id = p.slot_id JOIN sessions s ON s.id = sl.session_id WHERE p.id = ? AND s.status = 'in_progress'`).get(photoId) as typeof row;
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
      if (row!.photo_count + 1 >= row!.slot_count) {
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
    const originalPath = ensureInside(paths.photosDirectory, row.original_path);
    return new Uint8Array(fs.readFileSync(originalPath));
  } finally {
    database.close();
  }
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
      const source = ensureInside(paths.photosDirectory, row.original_path);
      const destination = ensureInside(backupFolder, path.join(backupFolder, path.basename(source)));
      const temporaryPath = `${destination}.${randomUUID()}.tmp`;
      await fs.promises.copyFile(source, temporaryPath);
      await fs.promises.rename(temporaryPath, destination);
    }
    database.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'in_progress'").run(newStatus, sessionId);
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
