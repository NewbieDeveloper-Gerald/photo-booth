import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/data/template-repository';
import { createSession } from './session-repository';
import { savePrintSheet } from './output-repository';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function setup(layoutId: string): { directory: string; sessionId: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-print-sheet-'));
  directories.push(directory);
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
  const { sessionId } = createSession(directory, layoutId);
  const db = new Database(path.join(directory, 'photobooth.sqlite'));
  db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(sessionId);
  db.close();
  return { directory, sessionId };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('strip cut sheet storage (F18)', () => {
  it('keeps the paired sheet beside the session and lets it be printed in preference', async () => {
    const { directory, sessionId } = setup('2x6-strip-2x1');
    const sheetPath = await savePrintSheet(directory, sessionId, jpeg, 1200, 1800);
    expect(fs.existsSync(sheetPath)).toBe(true);
    expect(path.basename(sheetPath)).toMatch(/^print-sheet-2x6-strip-2x1-/);
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    expect(db.prepare('SELECT kind, width, height FROM outputs WHERE session_id = ?').get(sessionId))
      .toEqual({ kind: 'print-sheet-2x6-strip-2x1', width: 1200, height: 1800 });
    db.close();
  });

  it('refuses a sheet for a layout that is not a strip, or a session that is still running', async () => {
    const fullPage = setup('grid-4-landscape');
    await expect(savePrintSheet(fullPage.directory, fullPage.sessionId, jpeg, 1200, 1800)).rejects.toThrow('Only a 20 × 60 mm strip needs a cut sheet');
    const strip = setup('2x6-strip-2x1');
    const db = new Database(path.join(strip.directory, 'photobooth.sqlite'));
    db.prepare("UPDATE sessions SET status = 'in_progress' WHERE id = ?").run(strip.sessionId);
    db.close();
    await expect(savePrintSheet(strip.directory, strip.sessionId, jpeg, 1200, 1800)).rejects.toThrow('Only completed sessions can save a print sheet');
    await expect(savePrintSheet(strip.directory, strip.sessionId, jpeg, 0, 1800)).rejects.toThrow('Invalid print sheet details');
  });
});
