import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../storage/database/initialize';
import { hasAdminPin, setAdminPin, verifyAdminPin } from './admin-pin';

const dirs: string[] = [];
function setup(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-admin-pin-'));
  dirs.push(dir);
  initializeStorage(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('admin PIN security', () => {
  it('stores a salted scrypt hash, never the raw PIN, and verifies it', () => {
    const dir = setup();
    expect(hasAdminPin(dir)).toBe(false);
    setAdminPin(dir, '381927');
    expect(hasAdminPin(dir)).toBe(true);
    expect(verifyAdminPin(dir, '381927')).toBe(true);
    expect(verifyAdminPin(dir, '381928')).toBe(false);
    const db = new Database(path.join(dir, 'photobooth.sqlite'));
    const row = db.prepare("SELECT value FROM settings WHERE key = 'adminPinHash'").get() as { value: string };
    db.close();
    expect(row.value).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(row.value).not.toContain('381927');
  });

  it('rejects weak formats and never verifies when no PIN has been set', () => {
    const dir = setup();
    expect(() => setAdminPin(dir, '1234')).toThrow(/6 to 12 digits/);
    expect(() => setAdminPin(dir, '12ab56')).toThrow(/6 to 12 digits/);
    expect(verifyAdminPin(dir, '123456')).toBe(false);
  });
});
