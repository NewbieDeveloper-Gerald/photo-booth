import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isEventId, isSessionId } from '../../../shared/validation/identifiers';
import { toErrorMessage } from '../../../shared/errors';
import { shouldPurgeSession } from '../domain/expiry';

import type { DeletionResult, PurgeResult, RetentionStatus } from '../domain/retention-types';
export type { DeletionResult, PurgeResult, RetentionStatus };

const LAST_SWEEP_KEY = 'retentionLastSweepAt';

type SessionRow = { id: string; eventId: string; status: string; tokenExpiresAt: string | null };

/** Counts the files first, then removes the folder: a session folder is the deletion unit. */
function removeFolder(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  let files = 0;
  for (const entry of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) files += 1;
  fs.rmSync(directory, { recursive: true, force: true });
  return files;
}

function sessionFolder(root: string, eventId: string, sessionId: string): string {
  return ensureInside(root, path.join(root, eventId, sessionId));
}

function eventFolder(root: string, eventId: string): string {
  return ensureInside(root, path.join(root, eventId));
}

function readSession(database: ReturnType<typeof openDatabase>, sessionId: string): SessionRow | undefined {
  return database.prepare(`SELECT s.id, s.event_id AS eventId, s.status, s.token_expires_at AS tokenExpiresAt
    FROM sessions s WHERE s.id = ?`).get(sessionId) as SessionRow | undefined;
}

/**
 * Removes one session from the booth: its photos, guest copies, finished layouts and backup
 * versions, then its database rows. An open session is refused, because deleting photos a
 * guest is still shooting would look like a crash.
 */
export function deleteSessionPermanently(userDataPath: string, sessionIdValue: unknown): DeletionResult {
  if (!isSessionId(sessionIdValue)) throw new Error('Invalid session id');
  const database = openDatabase(userDataPath);
  try {
    const session = readSession(database, sessionIdValue);
    if (!session) throw new Error('Session not found');
    if (session.status === 'in_progress') throw new Error('Finish or discard the open session before deleting it');
    const paths = getConfiguredStoragePaths(userDataPath);
    const deletedFiles = removeFolder(sessionFolder(paths.photosDirectory, session.eventId, session.id))
      + removeFolder(sessionFolder(paths.backupDirectory, session.eventId, session.id));
    database.transaction(() => {
      database.prepare('DELETE FROM upload_queue WHERE session_id = ?').run(session.id);
      database.prepare('DELETE FROM outputs WHERE session_id = ?').run(session.id);
      database.prepare('DELETE FROM photos WHERE slot_id IN (SELECT id FROM slots WHERE session_id = ?)').run(session.id);
      database.prepare('DELETE FROM slots WHERE session_id = ?').run(session.id);
      database.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    })();
    return { deletedSessions: 1, deletedFiles };
  } finally { database.close(); }
}

/**
 * Removes an event with every session under it. The booth always keeps one event, and an
 * event with an open session is refused for the same reason as a single session.
 */
function loadEventDeletionPlan(userDataPath: string, eventId: string): { id: string; sessionIds: string[] } {
  const database = openDatabase(userDataPath);
  try {
    const event = database.prepare('SELECT id FROM events WHERE id = ?').get(eventId) as { id: string } | undefined;
    if (!event) throw new Error('Event not found');
    const remaining = database.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number };
    if (remaining.count <= 1) throw new Error('Keep at least one event on the booth');
    const open = database.prepare("SELECT COUNT(*) AS count FROM sessions WHERE event_id = ? AND status = 'in_progress'").get(event.id) as { count: number };
    if (open.count > 0) throw new Error('Finish or discard the open session before deleting this event');
    const sessionIds = database.prepare('SELECT id FROM sessions WHERE event_id = ?').all(event.id) as Array<{ id: string }>;
    return { id: event.id, sessionIds: sessionIds.map((row) => row.id) };
  } finally { database.close(); }
}

/**
 * Removes an event with every session under it. The booth always keeps one event, and an
 * event with an open session is refused for the same reason as a single session.
 */
export function deleteEventPermanently(userDataPath: string, eventIdValue: unknown): DeletionResult {
  if (!isEventId(eventIdValue)) throw new Error('Invalid event id');
  const plan = loadEventDeletionPlan(userDataPath, eventIdValue);
  // File removal happens outside any database lock, and each session cleans up its own folder.
  let deletedFiles = 0;
  for (const sessionId of plan.sessionIds) deletedFiles += deleteSessionPermanently(userDataPath, sessionId).deletedFiles;
  const paths = getConfiguredStoragePaths(userDataPath);
  deletedFiles += removeFolder(eventFolder(paths.photosDirectory, plan.id));
  deletedFiles += removeFolder(eventFolder(paths.backupDirectory, plan.id));
  deletedFiles += removeFolder(eventAssetsFolder(userDataPath, plan.id));
  const database = openDatabase(userDataPath);
  try {
    database.transaction(() => {
      database.prepare('DELETE FROM events WHERE id = ?').run(plan.id);
      const active = database.prepare("SELECT value FROM settings WHERE key = 'activeEventId'").get() as { value: string } | undefined;
      if (active?.value !== plan.id) return;
      const next = database.prepare('SELECT id FROM events ORDER BY name COLLATE NOCASE LIMIT 1').get() as { id: string } | undefined;
      if (!next) return;
      database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('activeEventId', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(next.id);
    })();
  } finally { database.close(); }
  return { deletedSessions: plan.sessionIds.length, deletedFiles };
}

function eventAssetsFolder(userDataPath: string, eventId: string): string {
  return ensureInside(userDataPath, path.join(userDataPath, 'event-assets', eventId));
}

function writeLastSweep(database: ReturnType<typeof openDatabase>, at: string): void {
  database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(LAST_SWEEP_KEY, at);
}

/**
 * The daily sweep: removes completed sessions whose guest link has expired. `beforeDelete`
 * is where a cloud provider removes its copy first; if that fails the local copy is kept so
 * the next sweep can retry, rather than deleting the only copy while another one is stuck.
 */
export async function purgeExpiredSessions(
  userDataPath: string,
  now = Date.now(),
  options: { beforeDelete?: (sessionId: string) => Promise<void> } = {},
): Promise<PurgeResult> {
  const database = openDatabase(userDataPath);
  let expired: SessionRow[] = [];
  try {
    expired = (database.prepare(`SELECT s.id, s.event_id AS eventId, s.status, s.token_expires_at AS tokenExpiresAt
      FROM sessions s`).all() as SessionRow[]).filter((session) => shouldPurgeSession(session, now));
  } finally { database.close(); }
  const result: PurgeResult = { deletedSessions: 0, deletedFiles: 0, skippedSessions: 0, lastSweepAt: new Date(now).toISOString(), errors: [] };
  for (const session of expired) {
    try {
      await options.beforeDelete?.(session.id);
      const deleted = deleteSessionPermanently(userDataPath, session.id);
      result.deletedSessions += deleted.deletedSessions;
      result.deletedFiles += deleted.deletedFiles;
    } catch (error) {
      result.skippedSessions += 1;
      result.errors.push(toErrorMessage(error, `Could not delete expired session ${session.id}`));
    }
  }
  const update = openDatabase(userDataPath);
  try { writeLastSweep(update, result.lastSweepAt); } finally { update.close(); }
  return result;
}

/** What the operator's retention line reports: when the last sweep ran and what is waiting. */
export function readRetentionStatus(userDataPath: string, now = Date.now()): RetentionStatus {
  const database = openDatabase(userDataPath);
  try {
    const synced = database.prepare('SELECT value FROM settings WHERE key = ?').get(LAST_SWEEP_KEY) as { value: string } | undefined;
    const rows = database.prepare("SELECT s.status, s.token_expires_at AS tokenExpiresAt FROM sessions s WHERE s.status = 'completed'").all() as Array<{ status: string; tokenExpiresAt: string | null }>;
    return { lastSweepAt: synced?.value ?? null, expiredSessions: rows.filter((row) => shouldPurgeSession(row, now)).length };
  } finally { database.close(); }
}
