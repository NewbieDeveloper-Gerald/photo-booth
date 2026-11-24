import { describe, expect, it } from 'vitest';
import { HOTKEYS, hotkeyLabel, isTypingTarget, matchHotkey } from './hotkeys';

const press = (overrides: Record<string, unknown> = {}) =>
  ({ key: 'r', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, repeat: false, ...overrides });

describe('operator hotkeys (F21)', () => {
  it('covers restart, reprint, skip upload and open admin', () => {
    expect(HOTKEYS.map((hotkey) => hotkey.action)).toEqual(['restart-session', 'reprint', 'skip-upload', 'open-admin']);
    expect(HOTKEYS.map(hotkeyLabel)).toEqual(['Ctrl + Shift + R', 'Ctrl + Shift + P', 'Ctrl + Shift + U', 'Ctrl + Shift + A']);
    expect(HOTKEYS.every((hotkey) => hotkey.description.length > 20 && hotkey.label.length > 3)).toBe(true);
  });

  it('matches each combination, in either letter case and with Cmd as well as Ctrl', () => {
    expect(matchHotkey(press({ key: 'r' }))).toBe('restart-session');
    expect(matchHotkey(press({ key: 'P' }))).toBe('reprint');
    expect(matchHotkey(press({ key: 'u' }))).toBe('skip-upload');
    expect(matchHotkey(press({ key: 'a', ctrlKey: false, metaKey: true }))).toBe('open-admin');
  });

  it('ignores everything that is not Ctrl+Shift plus the letter', () => {
    expect(matchHotkey(press({ shiftKey: false }))).toBeNull();
    expect(matchHotkey(press({ ctrlKey: false }))).toBeNull();
    expect(matchHotkey(press({ altKey: true }))).toBeNull();
    expect(matchHotkey(press({ repeat: true }))).toBeNull();
    expect(matchHotkey(press({ key: 'x' }))).toBeNull();
    expect(matchHotkey(press({ key: 'Enter' }))).toBeNull();
  });

  it('stays out of the way while a guest is typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'select' })).toBe(true);
    expect(isTypingTarget({ tagName: 'div', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'button' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
