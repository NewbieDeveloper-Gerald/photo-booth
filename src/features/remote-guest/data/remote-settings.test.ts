import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureRemoteToken, isRemoteToken, readRemoteEnabled, readRemoteToken, rotateRemoteToken, setRemoteEnabled } from './remote-settings';

const dirs: string[] = [];
function setup(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-remote-'));
  dirs.push(dir);
  initializeStorage(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('tablet screen settings (F22)', () => {
  it('starts switched off, with no link until one is asked for', () => {
    const dir = setup();
    expect(readRemoteEnabled(dir)).toBe(false);
    expect(readRemoteToken(dir)).toBeNull();
    setRemoteEnabled(dir, true);
    expect(readRemoteEnabled(dir)).toBe(true);
    setRemoteEnabled(dir, false);
    expect(readRemoteEnabled(dir)).toBe(false);
    expect(() => setRemoteEnabled(dir, 'yes')).toThrow(/on or off/);
  });

  it('keeps one unguessable link until it is rotated', () => {
    const dir = setup();
    const token = ensureRemoteToken(dir);
    expect(isRemoteToken(token)).toBe(true);
    expect(token).toHaveLength(22);
    expect(ensureRemoteToken(dir)).toBe(token);
    expect(readRemoteToken(dir)).toBe(token);
    const rotated = rotateRemoteToken(dir);
    expect(rotated).not.toBe(token);
    expect(readRemoteToken(dir)).toBe(rotated);
  });

  it('only accepts a token of the right shape', () => {
    expect(isRemoteToken('a'.repeat(22))).toBe(true);
    expect(isRemoteToken('a'.repeat(21))).toBe(false);
    expect(isRemoteToken('a'.repeat(22) + '/')).toBe(false);
    expect(isRemoteToken(null)).toBe(false);
  });
});
