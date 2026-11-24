import fs from 'node:fs';
import { openDatabase } from '../../storage/database/connection';
import { toErrorMessage } from '../../../shared/errors';
import { isSessionId } from '../../../shared/validation/identifiers';
import { MAX_UPLOAD_ERROR_LENGTH } from '../../../shared/constants/limits';
import { nextRetryDelayMs } from './retry-policy';

import type { UploadAdapter, UploadQueueItem, UploadQueueSummary, UploadTickResult } from './types';
export type { UploadAdapter, UploadQueueItem, UploadQueueSummary, UploadTickResult };

/** Settings key holding the last successful upload time; internal, never editable by the renderer. */
const LAST_SYNCED_AT_KEY = 'uploadLastSyncedAt';
function mapItem(row: Record<string, unknown>): UploadQueueItem {
  return { id: String(row.id), sessionId: String(row.session_id), filePath: String(row.file_path), status: row.status as UploadQueueItem['status'], attempts: Number(row.attempts), nextRetryAt: row.next_retry_at === null ? null : String(row.next_retry_at), lastError: row.last_error === null ? null : String(row.last_error), createdAt: String(row.created_at) };
}

export function enqueueSessionFiles(userDataPath: string, sessionId: unknown): number {
  if (!isSessionId(sessionId)) throw new Error('Invalid session id');
  const database = openDatabase(userDataPath);
  try {
    const session = database.prepare("SELECT id FROM sessions WHERE id = ? AND status = 'completed'").get(sessionId);
    if (!session) throw new Error('Only completed sessions can be queued');
    // Originals are intentionally excluded. Queue only generated download copies and the finished layout.
    const files = database.prepare(`SELECT download_path AS filePath FROM photos p JOIN slots sl ON sl.id = p.slot_id
      WHERE sl.session_id = ? AND p.photo_state = 'current' AND p.download_path IS NOT NULL
      UNION SELECT output_path AS filePath FROM outputs WHERE session_id = ? AND kind LIKE 'finished-%'`).all(sessionId, sessionId) as Array<{ filePath: string }>;
    const insert = database.prepare(`INSERT OR IGNORE INTO upload_queue (id, session_id, file_path, status, attempts, next_retry_at, last_error)
      VALUES (lower(hex(randomblob(16))), ?, ?, 'pending', 0, datetime('now'), NULL)`);
    return database.transaction(() => files.reduce((count, file) => count + Number(insert.run(sessionId, file.filePath).changes), 0))();
  } finally { database.close(); }
}

export function listUploadQueue(userDataPath: string): UploadQueueSummary {
  const database = openDatabase(userDataPath);
  try {
    const rows = database.prepare('SELECT status, COUNT(*) AS count FROM upload_queue GROUP BY status').all() as Array<{ status: string; count: number }>;
    const counts = new Map(rows.map((row) => [row.status, row.count]));
    const waiting = database.prepare("SELECT COUNT(DISTINCT session_id) AS sessions FROM upload_queue WHERE status IN ('pending', 'uploading', 'failed')").get() as { sessions: number };
    const failed = database.prepare("SELECT COUNT(DISTINCT session_id) AS sessions FROM upload_queue WHERE status = 'failed'").get() as { sessions: number };
    const lastError = database.prepare("SELECT last_error AS lastError FROM upload_queue WHERE last_error IS NOT NULL AND last_error != '' ORDER BY created_at DESC LIMIT 1").get() as { lastError: string } | undefined;
    const nextRetry = database.prepare("SELECT MIN(next_retry_at) AS nextRetryAt FROM upload_queue WHERE status = 'pending' AND next_retry_at IS NOT NULL").get() as { nextRetryAt: string | null };
    const synced = database.prepare('SELECT value FROM settings WHERE key = ?').get(LAST_SYNCED_AT_KEY) as { value: string } | undefined;
    return {
      waitingFiles: (counts.get('pending') ?? 0) + (counts.get('uploading') ?? 0),
      failedFiles: counts.get('failed') ?? 0,
      uploadedFiles: counts.get('uploaded') ?? 0,
      waitingSessions: waiting.sessions,
      failedSessions: failed.sessions,
      lastError: lastError?.lastError ?? null,
      lastSyncedAt: synced?.value ?? null,
      nextRetryAt: nextRetry.nextRetryAt,
      providerConfigured: false,
    };
  } finally { database.close(); }
}

export function recoverInterruptedUploads(userDataPath: string): number {
  const database = openDatabase(userDataPath);
  try { return database.prepare("UPDATE upload_queue SET status = 'pending', next_retry_at = datetime('now'), last_error = 'Recovered after app restart' WHERE status = 'uploading'").run().changes; }
  finally { database.close(); }
}

export async function processDueUploads(userDataPath: string, adapter: UploadAdapter, now = Date.now(), limit = 20): Promise<UploadTickResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid queue batch limit');
  const database = openDatabase(userDataPath);
  const result: UploadTickResult = { processed: 0, uploaded: 0, failed: 0 };
  try {
    const rows = database.prepare(`SELECT id, session_id, file_path, status, attempts, next_retry_at, last_error, created_at
      FROM upload_queue WHERE status = 'pending' AND (next_retry_at IS NULL OR julianday(next_retry_at) <= julianday(?))
      ORDER BY created_at LIMIT ?`).all(new Date(now).toISOString(), limit) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const item = mapItem(row);
      const claimed = database.prepare("UPDATE upload_queue SET status = 'uploading' WHERE id = ? AND status = 'pending'").run(item.id).changes;
      if (!claimed) continue;
      try {
        await adapter.upload(item);
        database.prepare("UPDATE upload_queue SET status = 'uploaded', attempts = attempts + 1, next_retry_at = NULL, last_error = NULL WHERE id = ?").run(item.id);
        result.uploaded += 1;
      } catch (error) {
        const attempts = item.attempts + 1;
        const delay = nextRetryDelayMs(attempts);
        const message = toErrorMessage(error, 'Upload failed').slice(0, MAX_UPLOAD_ERROR_LENGTH);
        database.prepare("UPDATE upload_queue SET status = 'pending', attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?")
          .run(attempts, new Date(now + delay).toISOString(), message, item.id);
        result.failed += 1;
      }
      result.processed += 1;
    }
    if (result.uploaded > 0) {
      database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(LAST_SYNCED_AT_KEY, new Date(now).toISOString());
    }
    return result;
  } finally { database.close(); }
}

export const mockUploadAdapter: UploadAdapter = { async upload(item) { if (!fs.existsSync(item.filePath)) throw new Error('Queued file is missing'); } };
