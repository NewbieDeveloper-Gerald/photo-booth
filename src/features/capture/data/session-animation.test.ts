import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { createSession } from '../node';
import { saveSessionAnimation } from './output-repository';
import { encodeGif } from '../../animation/domain/gif-encoder';

const dirs: string[] = [];
function setup(): { dir: string; sessionId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-animation-'));
  dirs.push(dir);
  initializeStorage(dir);
  const { sessionId } = createSession(dir);
  return { dir, sessionId };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function gif(): Uint8Array {
  const rgba = new Uint8Array(4 * 4 * 4).fill(200);
  return new Uint8Array(encodeGif([{ rgba }], { width: 4, height: 4, delayCs: 40 }));
}

describe('saving an animated extra (F23)', () => {
  it('stores a GIF next to the session and records its kind and size', async () => {
    const { dir, sessionId } = setup();
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(sessionId);
    db.close();
    const outputPath = await saveSessionAnimation(dir, sessionId, gif(), 'gif');
    expect(outputPath.endsWith('.gif')).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(true);
    const check = new Database(path.join(dir, 'photobooth.sqlite'));
    const row = check.prepare('SELECT kind, width, height FROM outputs WHERE session_id = ?').get(sessionId) as { kind: string; width: number; height: number };
    check.close();
    expect(row).toEqual({ kind: 'gif', width: 4, height: 4 });
  });

  it('calls a boomerang a boomerang', async () => {
    const { dir, sessionId } = setup();
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(sessionId);
    db.close();
    const outputPath = await saveSessionAnimation(dir, sessionId, gif(), 'boomerang');
    expect(path.basename(outputPath).startsWith('boomerang-')).toBe(true);
  });

  it('refuses a session that is not finished, a bad kind and anything that is not a GIF', async () => {
    const { dir, sessionId } = setup();
    await expect(saveSessionAnimation(dir, sessionId, gif(), 'gif')).rejects.toThrow(/completed sessions/);
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(sessionId);
    db.close();
    await expect(saveSessionAnimation(dir, sessionId, gif(), 'video')).rejects.toThrow(/GIF or a boomerang/);
    await expect(saveSessionAnimation(dir, sessionId, new Uint8Array(64).fill(0xff), 'gif')).rejects.toThrow(/must be a GIF/);
    await expect(saveSessionAnimation(dir, 'not-a-session', gif(), 'gif')).rejects.toThrow(/Invalid session id/);
  });
});
