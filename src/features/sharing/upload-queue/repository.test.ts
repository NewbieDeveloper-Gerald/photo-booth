import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { createSession } from '../../capture/node';
import { enqueueSessionFiles, listUploadQueue, processDueUploads, recoverInterruptedUploads, skipPendingUploads, type UploadQueueItem } from './repository';

const dirs: string[] = [];
function setup(): { dir: string; sessionId: string; outputPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-upload-queue-'));
  dirs.push(dir);
  initializeStorage(dir);
  const { sessionId } = createSession(dir);
  const outputPath = path.join(dir, 'photos', 'default-event', sessionId, 'finished-test.jpg');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from([1, 2, 3]));
  const db = new Database(path.join(dir, 'photobooth.sqlite'));
  db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(sessionId);
  db.prepare("INSERT INTO outputs (id, session_id, output_path, kind) VALUES (?, ?, ?, 'finished-test')").run('output-1', sessionId, outputPath);
  db.close();
  return { dir, sessionId, outputPath };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('persistent upload queue', () => {
  it('queues generated outputs idempotently and never queues original photos', () => {
    const { dir, sessionId, outputPath } = setup();
    expect(enqueueSessionFiles(dir, sessionId)).toBe(1);
    expect(enqueueSessionFiles(dir, sessionId)).toBe(0);
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    expect(db.prepare('SELECT file_path FROM upload_queue').all()).toEqual([{ file_path: outputPath }]);
    db.close();
    expect(listUploadQueue(dir)).toMatchObject({ waitingFiles: 1, failedFiles: 0, uploadedFiles: 0, waitingSessions: 1, failedSessions: 0, lastSyncedAt: null, providerConfigured: false });
  });

  it('records mock failures, schedules exponential retry, then marks success', async () => {
    const { dir, sessionId } = setup();
    enqueueSessionFiles(dir, sessionId);
    const now = Date.now();
    const bad = { async upload() { throw new Error('Temporary mock failure'); } };
    expect(await processDueUploads(dir, bad, now)).toEqual({ processed: 1, uploaded: 0, failed: 1 });
    expect(listUploadQueue(dir)).toMatchObject({ waitingFiles: 1, lastError: 'Temporary mock failure', lastSyncedAt: null });
    expect(listUploadQueue(dir).nextRetryAt).not.toBeNull();
    expect(Date.parse(listUploadQueue(dir).nextRetryAt!)).toBe(now + 30_000);
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    const retryAt = db.prepare('SELECT next_retry_at AS retryAt, attempts FROM upload_queue').get() as { retryAt: string; attempts: number };
    db.close();
    expect(retryAt.attempts).toBe(1);
    expect(Date.parse(retryAt.retryAt)).toBe(now + 30_000);
    const uploaded: UploadQueueItem[] = [];
    expect(await processDueUploads(dir, { async upload(item) { uploaded.push(item); } }, now + 30_001)).toEqual({ processed: 1, uploaded: 1, failed: 0 });
    expect(uploaded).toHaveLength(1);
    expect(listUploadQueue(dir)).toMatchObject({ waitingFiles: 0, waitingSessions: 0, uploadedFiles: 1, lastError: null, lastSyncedAt: new Date(now + 30_001).toISOString(), nextRetryAt: null });
  });

  it('skips waiting uploads on request without deleting anything (F21)', async () => {
    const { dir, sessionId, outputPath } = setup();
    enqueueSessionFiles(dir, sessionId);
    const now = Date.now();
    await processDueUploads(dir, { async upload() { throw new Error('offline'); } }, now);
    // A failed mock upload goes back to pending with a backoff, so it still counts as waiting.
    expect(listUploadQueue(dir)).toMatchObject({ waitingFiles: 1, failedFiles: 0 });
    expect(skipPendingUploads(dir, sessionId)).toBe(1);
    expect(listUploadQueue(dir)).toMatchObject({ waitingFiles: 0, failedFiles: 0, skippedFiles: 1, waitingSessions: 0 });
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    expect(db.prepare('SELECT status, file_path FROM upload_queue').all()).toEqual([{ status: 'skipped', file_path: outputPath }]);
    db.close();
    // Skipped files are never picked up again, and re-skipping finds nothing to do.
    expect(await processDueUploads(dir, { async upload() {} }, now + 10 * 60_000)).toEqual({ processed: 0, uploaded: 0, failed: 0 });
    expect(skipPendingUploads(dir)).toBe(0);
    expect(() => skipPendingUploads(dir, 'not-a-session')).toThrow(/Invalid session id/);
  });

  it('counts a session once no matter how many of its files are queued', () => {
    const { dir, sessionId, outputPath } = setup();
    const second = `${outputPath}-2`;
    fs.writeFileSync(second, Buffer.from([4, 5, 6]));
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    db.prepare("INSERT INTO outputs (id, session_id, output_path, kind) VALUES (?, ?, ?, 'finished-test')").run('output-2', sessionId, second);
    db.close();
    expect(enqueueSessionFiles(dir, sessionId)).toBe(2);
    expect(listUploadQueue(dir)).toMatchObject({ waitingFiles: 2, waitingSessions: 1 });
  });

  it('only records a sync time after a successful upload', async () => {
    const { dir, sessionId } = setup();
    enqueueSessionFiles(dir, sessionId);
    const now = Date.now();
    await processDueUploads(dir, { async upload() { throw new Error('offline'); } }, now);
    expect(listUploadQueue(dir).lastSyncedAt).toBeNull();
    await processDueUploads(dir, { async upload() { /* mock success */ } }, now + 60_000);
    expect(listUploadQueue(dir).lastSyncedAt).toBe(new Date(now + 60_000).toISOString());
  });

  it('recovers an interrupted in-flight item after app restart', () => {
    const { dir, sessionId } = setup();
    enqueueSessionFiles(dir, sessionId);
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    db.prepare("UPDATE upload_queue SET status = 'uploading'").run();
    db.close();
    expect(recoverInterruptedUploads(dir)).toBe(1);
    expect(listUploadQueue(dir)).toMatchObject({ waitingFiles: 1, waitingSessions: 1 });
  });
});
