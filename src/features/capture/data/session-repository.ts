import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import { storedPhotoPath } from './photo-files';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isSessionId } from '../../../shared/validation/identifiers';
import { loadTemplate } from '../../layouts/data/template-repository';
import { getActiveEvent } from '../../events/data/event-repository';
import type { ActiveEvent } from '../../../shared/types/event';
import type { SessionRecord, UnfinishedSession } from '../../../shared/types/session';

/**
 * The template decides how many photos a session takes (F11): 1–6 slots, not the
 * event's advisory shot count. The chosen template id is stored on the session.
 */
export function createSession(userDataPath: string, layoutIdValue: unknown = 'double-strip-3'): { sessionId: string; event: ActiveEvent; shots: number; layoutId: string } {
  if (typeof layoutIdValue !== 'string' || !layoutIdValue) throw new Error('Choose a layout before starting a session');
  const event = getActiveEvent(userDataPath);
  const template = loadTemplate(userDataPath, layoutIdValue);
  const sessionId = randomUUID();
  const database = openDatabase(userDataPath);
  try {
    database.transaction(() => {
      database.prepare('INSERT INTO sessions (id, event_id, status, retake_limit, layout_id) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, event.id, 'in_progress', event.retakeLimit, template.id);
      const insertSlot = database.prepare('INSERT INTO slots (id, session_id, slot_number, status) VALUES (?, ?, ?, ?)');
      for (let slot = 1; slot <= template.shots; slot += 1) insertSlot.run(randomUUID(), sessionId, slot, 'empty');
    })();
    return { sessionId, event, shots: template.shots, layoutId: template.id };
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
  if (!isSessionId(sessionId)) throw new Error('Invalid session id');
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

async function copySessionOriginalsToBackup(userDataPath: string, sessionId: string, newStatus: 'abandoned' | 'discarded'): Promise<void> {
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
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
  if (!isSessionId(sessionId)) throw new Error('Invalid session id');
  await copySessionOriginalsToBackup(userDataPath, sessionId, 'abandoned');
}

export async function discardSession(userDataPath: string, sessionId: unknown): Promise<void> {
  if (!isSessionId(sessionId)) throw new Error('Invalid session id');
  await copySessionOriginalsToBackup(userDataPath, sessionId, 'discarded');
}
