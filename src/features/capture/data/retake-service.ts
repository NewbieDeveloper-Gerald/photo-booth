import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import { copyBackupVersion, moveWithinPhotos, storedPhotoPath } from './photo-files';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { canRetake } from '../../../core/retakes';
import { isRecordId, isSessionId } from '../../../shared/validation/identifiers';

export async function commitRetake(userDataPath: string, sessionId: unknown, slotNumber: unknown, newPhotoId: unknown): Promise<void> {
  if (!isSessionId(sessionId) || !Number.isInteger(slotNumber) || !isRecordId(newPhotoId)) throw new Error('Invalid retake request');
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
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
  if (!isSessionId(sessionId) || !Number.isInteger(slotNumber)) throw new Error('Invalid revert request');
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
