import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { createSession } from '../../capture/node';
import { deleteEventPermanently, deleteSessionPermanently, purgeExpiredSessions, readRetentionStatus } from './retention-repository';
import { shouldPurgeSession } from '../domain/expiry';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

type Fixture = { directory: string; sessionId: string; photosRoot: string; backupRoot: string; eventId: string };

/** A completed session with one photo, a guest copy, a finished layout and a backup version. */
function setup(expiresAt: string | null, status = 'completed'): Fixture {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-retention-'));
  directories.push(directory);
  initializeStorage(directory);
  const paths = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string; backupDirectory: string };
  const { sessionId } = createSession(directory);
  const db = new Database(path.join(directory, 'photobooth.sqlite'));
  const eventId = (db.prepare('SELECT event_id AS eventId FROM sessions WHERE id = ?').get(sessionId) as { eventId: string }).eventId;
  const sessionFolder = path.join(paths.photosDirectory, eventId, sessionId);
  const backupFolder = path.join(paths.backupDirectory, eventId, sessionId);
  fs.mkdirSync(sessionFolder, { recursive: true });
  fs.mkdirSync(backupFolder, { recursive: true });
  const original = path.join(sessionFolder, 'slot-1.jpg');
  const guestCopy = path.join(sessionFolder, 'slot-1-guest.jpg');
  const output = path.join(sessionFolder, 'finished-double-strip-3.jpg');
  for (const file of [original, guestCopy, output]) fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(backupFolder, 'slot-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const slotId = (db.prepare('SELECT id FROM slots WHERE session_id = ? ORDER BY slot_number LIMIT 1').get(sessionId) as { id: string }).id;
  db.prepare("INSERT INTO photos (id, slot_id, original_path, download_path, width, height, photo_state) VALUES ('photo-1', ?, ?, ?, 100, 100, 'current')").run(slotId, original, guestCopy);
  db.prepare('UPDATE slots SET status = ?, current_photo_id = ? WHERE id = ?').run('captured', 'photo-1', slotId);
  db.prepare("INSERT INTO outputs (id, session_id, output_path, kind) VALUES ('output-1', ?, ?, 'finished-double-strip-3')").run(sessionId, output);
  db.prepare("INSERT INTO upload_queue (id, session_id, file_path, status) VALUES ('queue-1', ?, ?, 'pending')").run(sessionId, output);
  db.prepare('UPDATE sessions SET status = ?, token_expires_at = ? WHERE id = ?').run(status, expiresAt, sessionId);
  db.close();
  return { directory, sessionId, photosRoot: paths.photosDirectory, backupRoot: paths.backupDirectory, eventId };
}

describe('retention rules (F15)', () => {
  it('only removes completed sessions whose guest link has expired', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(shouldPurgeSession({ status: 'completed', tokenExpiresAt: '2026-11-24T11:59:00Z' }, now)).toBe(true);
    expect(shouldPurgeSession({ status: 'completed', tokenExpiresAt: '2026-11-25T12:00:00Z' }, now)).toBe(false);
    expect(shouldPurgeSession({ status: 'completed', tokenExpiresAt: null }, now)).toBe(false);
    expect(shouldPurgeSession({ status: 'in_progress', tokenExpiresAt: '2026-11-01T00:00:00Z' }, now)).toBe(false);
    expect(shouldPurgeSession({ status: 'completed', tokenExpiresAt: 'not a date' }, now)).toBe(false);
  });
});

describe('session deletion (F15)', () => {
  it('removes the session, its files, guest copies, layout and backup version', () => {
    const { directory, sessionId, eventId, photosRoot, backupRoot } = setup(null);
    const result = deleteSessionPermanently(directory, sessionId);
    expect(result).toEqual({ deletedSessions: 1, deletedFiles: 4 });
    expect(fs.existsSync(path.join(photosRoot, eventId, sessionId))).toBe(false);
    expect(fs.existsSync(path.join(backupRoot, eventId, sessionId))).toBe(false);
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM photos').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM slots').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM outputs').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM upload_queue').get()).toEqual({ count: 0 });
    db.close();
  });

  it('refuses to delete a session a guest is still shooting', () => {
    const { directory, sessionId } = setup(null, 'in_progress');
    expect(() => deleteSessionPermanently(directory, sessionId)).toThrow(/Finish or discard the open session/);
  });

  it('takes a queued print job with the session (F18)', () => {
    const { directory, sessionId } = setup(null);
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    const eventId = (db.prepare('SELECT event_id AS eventId FROM sessions WHERE id = ?').get(sessionId) as { eventId: string }).eventId;
    db.prepare("INSERT INTO print_jobs (id, session_id, event_id, printer_name) VALUES ('print-1', ?, ?, 'DNP QW410')").run(sessionId, eventId);
    db.close();
    expect(deleteSessionPermanently(directory, sessionId).deletedSessions).toBe(1);
    const after = new Database(path.join(directory, 'photobooth.sqlite'));
    expect(after.prepare('SELECT COUNT(*) AS count FROM print_jobs').get()).toEqual({ count: 0 });
    after.close();
  });

  it('rejects unknown sessions and bad ids', () => {
    const { directory } = setup(null);
    expect(() => deleteSessionPermanently(directory, '00000000-0000-0000-0000-000000000000')).toThrow(/not found/);
    expect(() => deleteSessionPermanently(directory, '../../etc')).toThrow(/Invalid session id/);
  });
});

describe('retention sweep (F15)', () => {
  it('deletes only the expired session and records when the sweep ran', async () => {
    const expired = setup('2026-11-01T00:00:00Z');
    const keep = setup('2026-12-31T00:00:00Z');
    const now = Date.parse('2026-11-24T12:00:00Z');
    const result = await purgeExpiredSessions(expired.directory, now);
    expect(result.deletedSessions).toBe(1);
    expect(result.deletedFiles).toBe(4);
    expect(result.skippedSessions).toBe(0);
    expect(result.lastSweepAt).toBe(new Date(now).toISOString());
    expect(readRetentionStatus(expired.directory, now)).toEqual({ lastSweepAt: new Date(now).toISOString(), expiredSessions: 0 });
    expect(readRetentionStatus(keep.directory, now)).toEqual({ lastSweepAt: null, expiredSessions: 0 });
  });

  it('keeps the local copy when the cloud deletion fails, so the next sweep retries', async () => {
    const { directory, sessionId } = setup('2026-11-01T00:00:00Z');
    const beforeDelete = vi.fn(async () => { throw new Error('Cloud is unreachable'); });
    const result = await purgeExpiredSessions(directory, Date.parse('2026-11-24T12:00:00Z'), { beforeDelete });
    expect(beforeDelete).toHaveBeenCalledWith(sessionId);
    expect(result).toMatchObject({ deletedSessions: 0, skippedSessions: 1 });
    expect(result.errors[0]).toContain('Cloud is unreachable');
    expect(readRetentionStatus(directory, Date.parse('2026-11-24T12:00:00Z')).expiredSessions).toBe(1);
  });

  it('deletes from the cloud before touching the booth copy', async () => {
    const { directory, sessionId } = setup('2026-11-01T00:00:00Z');
    const order: string[] = [];
    await purgeExpiredSessions(directory, Date.parse('2026-11-24T12:00:00Z'), {
      beforeDelete: async (id) => { order.push(`cloud:${id}`); },
    });
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    const stillThere = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?').get(sessionId) as { count: number };
    db.close();
    expect(order).toEqual([`cloud:${sessionId}`]);
    expect(stillThere.count).toBe(0);
  });
});

describe('event deletion (F15)', () => {
  it('removes the event with every session under it', () => {
    const { directory, eventId } = setup(null);
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    db.prepare("INSERT INTO events (id, name) VALUES ('second-event', 'Second Event')").run();
    db.close();
    const result = deleteEventPermanently(directory, eventId);
    expect(result.deletedSessions).toBe(1);
    const check = new Database(path.join(directory, 'photobooth.sqlite'));
    expect(check.prepare('SELECT id FROM events').all()).toEqual([{ id: 'second-event' }]);
    expect(check.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    expect(check.prepare("SELECT value FROM settings WHERE key = 'activeEventId'").get()).toEqual({ value: 'second-event' });
    check.close();
  });

  it('keeps the last event on the booth', () => {
    const { directory, eventId } = setup(null);
    expect(() => deleteEventPermanently(directory, eventId)).toThrow(/Keep at least one event/);
  });

  it('refuses an event with an open session', () => {
    const { directory, eventId } = setup(null, 'in_progress');
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    db.prepare("INSERT INTO events (id, name) VALUES ('second-event', 'Second Event')").run();
    db.close();
    expect(() => deleteEventPermanently(directory, eventId)).toThrow(/open session/);
  });
});
