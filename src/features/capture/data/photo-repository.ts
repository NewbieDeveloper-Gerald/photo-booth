import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import { writeAtomically, copyBackupVersion, storedPhotoPath, toPhotoBuffer } from './photo-files';
import { canRetake } from '../../../core/retakes';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isRecordId, isSessionId } from '../../../shared/validation/identifiers';

export async function saveOriginalPhoto(
  userDataPath: string,
  sessionId: unknown,
  slotNumber: unknown,
  data: unknown,
  width: unknown,
  height: unknown,
): Promise<{ photoId: string; width: number; height: number }> {
  if (!isSessionId(sessionId) || !Number.isInteger(slotNumber) ||
      !Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1 ||
      (width as number) > 20000 || (height as number) > 20000) throw new Error('Invalid capture details');
  const bytes = toPhotoBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
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
  if (!isSessionId(sessionId) || !Number.isInteger(slotNumber) ||
      !Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1 ||
      (width as number) > 20000 || (height as number) > 20000) throw new Error('Invalid retake details');
  const bytes = toPhotoBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
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

export async function saveDownloadCopy(userDataPath: string, photoId: unknown, data: unknown): Promise<void> {
  if (!isRecordId(photoId)) throw new Error('Invalid photo id');
  const bytes = toPhotoBuffer(data);
  const database = openDatabase(userDataPath);
  let row: { original_path: string; session_id: string; photo_state: string } | undefined;
  const paths = getConfiguredStoragePaths(userDataPath);
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
  if (!isRecordId(photoId)) throw new Error('Invalid photo id');
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
  try {
    const row = database.prepare('SELECT original_path FROM photos WHERE id = ?').get(photoId) as { original_path: string } | undefined;
    if (!row) throw new Error('Photo not found');
    const originalPath = storedPhotoPath(paths, row.original_path);
    return new Uint8Array(fs.readFileSync(originalPath));
  } finally {
    database.close();
  }
}
