import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../storage/database';
import { createSession } from '../features/capture';
import { enqueueSessionFiles, listUploadQueue, processDueUploads, recoverInterruptedUploads, type UploadQueueItem } from './upload-queue';

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
    expect(listUploadQueue(dir)).toMatchObject({ pending: 1, uploading: 0, uploaded: 0, failed: 0, providerConfigured: false });
  });

  it('records mock failures, schedules exponential retry, then marks success', async () => {
    const { dir, sessionId } = setup();
    enqueueSessionFiles(dir, sessionId);
    const now = Date.now();
    const bad = { async upload() { throw new Error('Temporary mock failure'); } };
    expect(await processDueUploads(dir, bad, now)).toBe(1);
    expect(listUploadQueue(dir)).toMatchObject({ pending: 1, lastError: 'Temporary mock failure' });
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    const retryAt = db.prepare('SELECT next_retry_at AS retryAt, attempts FROM upload_queue').get() as { retryAt: string; attempts: number };
    db.close();
    expect(retryAt.attempts).toBe(1);
    expect(Date.parse(retryAt.retryAt)).toBe(now + 30_000);
    const uploaded: UploadQueueItem[] = [];
    expect(await processDueUploads(dir, { async upload(item) { uploaded.push(item); } }, now + 30_001)).toBe(1);
    expect(uploaded).toHaveLength(1);
    expect(listUploadQueue(dir)).toMatchObject({ pending: 0, uploaded: 1, lastError: null });
  });

  it('recovers an interrupted in-flight item after app restart', () => {
    const { dir, sessionId } = setup();
    enqueueSessionFiles(dir, sessionId);
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    db.prepare("UPDATE upload_queue SET status = 'uploading'").run();
    db.close();
    expect(recoverInterruptedUploads(dir)).toBe(1);
    expect(listUploadQueue(dir)).toMatchObject({ pending: 1, uploading: 0 });
  });
});
