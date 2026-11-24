import { describe, expect, it } from 'vitest';
import { isBlockedKioskShortcut } from './kiosk-keys';
import { HOTKEYS } from '../../../renderer/lib/hotkeys';

const key = (overrides: Partial<{ key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) =>
  ({ key: 'r', control: false, shift: false, alt: false, meta: false, ...overrides });

describe('kiosk key blocking (F21)', () => {
  it('blocks the ways out of a kiosk: reload, DevTools and F12', () => {
    expect(isBlockedKioskShortcut(key({ key: 'r', control: true }))).toBe(true);
    expect(isBlockedKioskShortcut(key({ key: 'R', control: true }))).toBe(true);
    expect(isBlockedKioskShortcut(key({ key: 'F5' }))).toBe(true);
    expect(isBlockedKioskShortcut(key({ key: 'F12' }))).toBe(true);
    for (const devtools of ['i', 'j', 'c']) {
      expect(isBlockedKioskShortcut(key({ key: devtools, control: true, shift: true }))).toBe(true);
      expect(isBlockedKioskShortcut(key({ key: devtools, meta: true, shift: true }))).toBe(true);
    }
  });

  it('leaves ordinary typing and the operator hotkeys alone', () => {
    expect(isBlockedKioskShortcut(key({ key: 'r' }))).toBe(false);
    expect(isBlockedKioskShortcut(key({ key: 'a', control: true }))).toBe(false);
    expect(isBlockedKioskShortcut(key({ key: 'Escape' }))).toBe(false);
  });

  it('never blocks an operator hotkey', () => {
    for (const hotkey of HOTKEYS) {
      expect(isBlockedKioskShortcut(key({ key: hotkey.key, control: true, shift: true }))).toBe(false);
      expect(isBlockedKioskShortcut(key({ key: hotkey.key, meta: true, shift: true }))).toBe(false);
    }
  });
});
