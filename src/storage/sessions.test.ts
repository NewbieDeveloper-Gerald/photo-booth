import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initializeStorage } from './database';
import { abandonSession, commitRetake, createSession, exportEventFolder, getActiveEvent, getLatestSessionPrintInfo, listUnfinishedSessions, loadSession, readOriginalPhoto, revertRetake, saveOriginalPhoto, saveRetakeOriginalPhoto, saveSessionOutput, setActiveEventRetakeLimit } from './sessions';

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

  it('saves only full-resolution originals and completes after all slots are captured', async () => {
    const directory = setup();
    const { sessionId } = createSession(directory);
    for (const slot of [1, 2, 3]) {
      const saved = await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 4000, 3000);
      const session = loadSession(directory, sessionId);
      expect(session.slots[slot - 1]?.photoId).toBe(saved.photoId);
    }
    const session = loadSession(directory, sessionId);
    expect(session.status).toBe('completed');
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    const file = database.prepare('SELECT original_path, download_path, width, height FROM photos LIMIT 1').get() as {
      original_path: string; download_path: string; width: number; height: number;
    };
    expect(fs.existsSync(file.original_path)).toBe(true);
    expect(file.download_path).toBeNull();
    expect(fs.readdirSync(path.dirname(file.original_path)).some((name) => name.endsWith('-download.jpg'))).toBe(false);
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

  it('keeps clearly named original and retake versions together and reverts without moving or deleting them', async () => {
    const directory = setup();
    const { sessionId } = createSession(directory);
    const originals = new Map<number, Uint8Array>();
    for (const slot of [1, 2, 3]) {
      const bytes = new Uint8Array([0xff, 0xd8, slot, 0xa0 + slot, 0xd9]);
      originals.set(slot, bytes);
      await saveOriginalPhoto(directory, sessionId, slot, bytes, 1920, 1080);
    }
    const before = loadSession(directory, sessionId);
    const untouched = [1, 3].map((slot) => before.slots[slot - 1]!.photoId);
    const newBytes = new Uint8Array([0xff, 0xd8, 0x77, 0x78, 0xd9]);
    const retake = await saveRetakeOriginalPhoto(directory, sessionId, 2, newBytes, 1920, 1080);
    await commitRetake(directory, sessionId, 2, retake.photoId);
    const secondRetakeBytes = new Uint8Array([0xff, 0xd8, 0x88, 0x89, 0xd9]);
    const secondRetake = await saveRetakeOriginalPhoto(directory, sessionId, 2, secondRetakeBytes, 1920, 1080);
    await commitRetake(directory, sessionId, 2, secondRetake.photoId);

    let after = loadSession(directory, sessionId);
    expect(after.retakesUsed).toBe(2);
    expect(after.slots[1]).toMatchObject({ photoId: secondRetake.photoId, previousPhotoId: retake.photoId, hasPrevious: true });
    expect(after.slots[0]?.photoId).toBe(untouched[0]);
    expect(after.slots[2]?.photoId).toBe(untouched[1]);
    expect(readOriginalPhoto(directory, after.slots[0]!.photoId)).toEqual(originals.get(1));
    expect(readOriginalPhoto(directory, after.slots[2]!.photoId)).toEqual(originals.get(3));
    expect(readOriginalPhoto(directory, after.slots[1]!.previousPhotoId)).toEqual(newBytes);

    await revertRetake(directory, sessionId, 2);
    after = loadSession(directory, sessionId);
    expect(after.slots[1]).toMatchObject({ photoId: retake.photoId, hasPrevious: false });
    expect(readOriginalPhoto(directory, after.slots[1]!.photoId)).toEqual(newBytes);
    expect(readOriginalPhoto(directory, secondRetake.photoId)).toEqual(secondRetakeBytes);
    expect(after.retakesUsed).toBe(2);
    expect(readOriginalPhoto(directory, after.slots[0]!.photoId)).toEqual(originals.get(1));
    expect(readOriginalPhoto(directory, after.slots[2]!.photoId)).toEqual(originals.get(3));
    const sessionFolder = path.join(directory, 'photos', 'default-event', sessionId);
    expect(fs.readdirSync(sessionFolder).sort()).toEqual(expect.arrayContaining([
      'slot-01-original.jpg', 'slot-02-original.jpg', 'slot-02-retake-01.jpg', 'slot-02-retake-02.jpg', 'slot-03-original.jpg',
    ]));
    const backupFolder = path.join(directory, 'backup', 'default-event', sessionId);
    expect(fs.readdirSync(backupFolder).sort()).toEqual(['slot-01-original.jpg', 'slot-02-original.jpg', 'slot-02-retake-01.jpg', 'slot-02-retake-02.jpg', 'slot-03-original.jpg']);
    expect(new Uint8Array(fs.readFileSync(path.join(backupFolder, 'slot-02-original.jpg')))).toEqual(originals.get(2));
    expect(fs.existsSync(path.join(directory, 'backup', 'default-event', sessionId, 'not-a-photo.jpg'))).toBe(false);
  });

  it('exports an event with photos and a full-size backup copy without moving originals', async () => {
    const directory = setup();
    const { sessionId } = createSession(directory);
    const original = new Uint8Array([0xff, 0xd8, 0x31, 0x32, 0xd9]);
    for (const slot of [1, 2, 3]) await saveOriginalPhoto(directory, sessionId, slot, original, 640, 480);
    const destination = path.join(directory, 'handoff');
    expect(await exportEventFolder(directory, 'default-event', destination)).toBe(destination);
    const relative = path.join('default-event', sessionId, 'slot-01-original.jpg');
    expect(new Uint8Array(fs.readFileSync(path.join(destination, 'photos', relative)))).toEqual(original);
    expect(new Uint8Array(fs.readFileSync(path.join(destination, 'backup', relative)))).toEqual(original);
    expect(fs.existsSync(path.join(directory, 'photos', relative))).toBe(true);
  });

  it('exposes a pending retake for recovery after an interrupted retake', async () => {
    const directory = setup();
    const { sessionId } = createSession(directory);
    for (const slot of [1, 2, 3]) {
      await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
    }
    const pending = await saveRetakeOriginalPhoto(directory, sessionId, 2, new Uint8Array([0xff, 0xd8, 0x66, 0xd9]), 640, 480);
    expect(listUnfinishedSessions(directory)).toMatchObject([{ id: sessionId, pendingRetakes: 1 }]);
    expect(loadSession(directory, sessionId).slots[1]?.pendingPhotoId).toBe(pending.photoId);
    await commitRetake(directory, sessionId, 2, pending.photoId);
    expect(listUnfinishedSessions(directory)).toEqual([]);
    expect(loadSession(directory, sessionId).slots[1]).toMatchObject({ photoId: pending.photoId, pendingPhotoId: null });
  });

  it('saves and records the selected print layout at the session-specific dimensions', async () => {
    const directory = setup();
    const { sessionId } = createSession(directory, 'grid-4-landscape');
    expect(loadSession(directory, sessionId)).toMatchObject({ layoutId: 'grid-4-landscape' });
    for (const slot of [1, 2, 3, 4]) await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
    const outputBytes = new Uint8Array([0xff, 0xd8, 0x55, 0xd9]);
    const outputPath = await saveSessionOutput(directory, sessionId, outputBytes, 1800, 1200);
    expect(getLatestSessionPrintInfo(directory, sessionId)).toEqual({ imagePath: outputPath, width: 1800, height: 1200 });
    expect(new Uint8Array(fs.readFileSync(outputPath))).toEqual(outputBytes);
    expect(path.dirname(outputPath)).toBe(path.join(directory, 'photos', 'default-event', sessionId));
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    expect(database.prepare('SELECT output_path, kind FROM outputs WHERE session_id = ?').get(sessionId)).toEqual({ output_path: outputPath, kind: 'finished-grid-4-landscape' });
    database.close();
    await expect(saveSessionOutput(directory, sessionId, outputBytes, 1200, 1800)).rejects.toThrow(/1800 by 1200/);
  });

  it('snapshots the event retake limit for a session and blocks zero-retake sessions', async () => {
    const directory = setup();
    setActiveEventRetakeLimit(directory, 0);
    const { sessionId } = createSession(directory);
    expect(loadSession(directory, sessionId).retakeLimit).toBe(0);
    for (const slot of [1, 2, 3]) {
      await saveOriginalPhoto(directory, sessionId, slot, tinyJpeg, 640, 480);
    }
    await expect(saveRetakeOriginalPhoto(directory, sessionId, 1, tinyJpeg, 640, 480)).rejects.toThrow(/limit/);
    setActiveEventRetakeLimit(directory, -1);
    const unlimited = createSession(directory);
    expect(unlimited.event.retakeLimit).toBe(-1);
  });
});
