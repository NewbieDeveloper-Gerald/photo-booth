import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initializeStorage } from './database';
import { abandonSession, createSession, getActiveEvent, listUnfinishedSessions, loadSession, saveDownloadCopy, saveOriginalPhoto } from './sessions';

const directories: string[] = [];
function setup(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-session-'));
  directories.push(directory);
  initializeStorage(directory);
  return directory;
}
const tinyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('session storage', () => {
  it('creates the default event once with required settings and creates three slots', () => {
    const directory = setup();
    initializeStorage(directory);
    expect(getActiveEvent(directory)).toEqual({ id: 'default-event', name: 'Default Event', shots: 3, retakeLimit: 3, printEnabled: true, expiryDays: 30 });
    const { sessionId } = createSession(directory);
    expect(loadSession(directory, sessionId).slots.map((slot) => slot.slotNumber)).toEqual([1, 2, 3]);
  });

  it('writes the original before its download copy and completes after all slots are copied', async () => {
    const directory = setup();
    const { sessionId } = createSession(directory);
    for (const slot of [1, 2, 3]) {
      const saved = await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 4000, 3000);
      const session = loadSession(directory, sessionId);
      expect(session.slots[slot - 1]?.photoId).toBe(saved.photoId);
      expect(session.slots[slot - 1]?.downloadReady).toBe(false);
      await saveDownloadCopy(directory, saved.photoId, tinyJpeg);
    }
    const session = loadSession(directory, sessionId);
    expect(session.status).toBe('completed');
    expect(session.slots.every((slot) => slot.downloadReady)).toBe(true);
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    const file = database.prepare('SELECT original_path, download_path, width, height FROM photos LIMIT 1').get() as {
      original_path: string; download_path: string; width: number; height: number;
    };
    expect(fs.existsSync(file.original_path)).toBe(true);
    expect(fs.existsSync(file.download_path)).toBe(true);
    expect(file).toMatchObject({ width: 4000, height: 3000 });
    database.close();
  });

  it('keeps an interrupted session resumable and backs its originals up when abandoned', async () => {
    const directory = setup();
    const { sessionId } = createSession(directory);
    await saveOriginalPhoto(directory, sessionId, 1, tinyJpeg, 1920, 1080);
    expect(listUnfinishedSessions(directory)[0]).toMatchObject({ id: sessionId, capturedSlots: 1, totalSlots: 3 });
    expect(loadSession(directory, sessionId).status).toBe('in_progress');
    await abandonSession(directory, sessionId);
    expect(loadSession(directory, sessionId).status).toBe('abandoned');
    const backupRoot = path.join(directory, 'backup', 'default-event', sessionId);
    expect(fs.readdirSync(backupRoot)).toHaveLength(1);
  });
});
