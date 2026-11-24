/**
 * Operator hotkeys (F21). Every combination needs Ctrl+Shift, so a guest leaning on the
 * keyboard cannot trigger one, and the kiosk's blocked keys (Ctrl+R, F12, Ctrl+Shift+I/J/C)
 * never overlap with them. The list is the single source for both the handler and the help
 * screen, so the printed help cannot drift from what the booth does.
 */
export type HotkeyAction = 'restart-session' | 'reprint' | 'skip-upload' | 'open-admin';

export type HotkeyDefinition = {
  action: HotkeyAction;
  /** The letter that completes Ctrl+Shift+<key>. */
  key: string;
  label: string;
  description: string;
  /** False for an action that only makes sense with the settings unlocked. */
  guestSafe: boolean;
};

export const HOTKEYS: HotkeyDefinition[] = [
  {
    action: 'restart-session', key: 'r', label: 'Restart session', guestSafe: false,
    description: 'Abandons the session on screen, backs its photos up and returns to the start screen. Only works while the settings are unlocked.',
  },
  {
    action: 'reprint', key: 'p', label: 'Reprint', guestSafe: true,
    description: 'Queues another print of the finished layout that is on screen.',
  },
  {
    action: 'skip-upload', key: 'u', label: 'Skip uploads', guestSafe: true,
    description: 'Marks the waiting sync files as skipped, so the panel stops counting them.',
  },
  {
    action: 'open-admin', key: 'a', label: 'Open admin', guestSafe: true,
    description: 'Shows the admin PIN prompt for the locked booth.',
  },
];

export function hotkeyLabel(hotkey: HotkeyDefinition): string {
  return `Ctrl + Shift + ${hotkey.key.toUpperCase()}`;
}

export type HotkeyInput = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean };

/**
 * The action for a key event, or null. Alt is excluded (AltGr types characters on some
 * layouts, and the OS uses Alt combinations), repeat is ignored so a held key cannot restart
 * a session twice, and either Ctrl or Cmd works so the shortcut is usable on a Mac booth.
 */
export function matchHotkey(input: HotkeyInput): HotkeyAction | null {
  if (input.altKey || input.repeat) return null;
  if (!input.shiftKey || (!input.ctrlKey && !input.metaKey)) return null;
  const key = input.key.toLowerCase();
  return HOTKEYS.find((hotkey) => hotkey.key === key)?.action ?? null;
}

/**
 * True while the guest is typing in a field: the letters R, P, U and A belong to the PIN and
 * the event form there, not to the booth.
 */
export function isTypingTarget(element: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}
