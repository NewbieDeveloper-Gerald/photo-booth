export type KioskKeyInput = { key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean };

/** Keys that would hand a guest a browser window, the DevTools or a reload (F21). */
const DEVTOOLS_KEYS = ['i', 'j', 'c'];

/**
 * True when the kiosk window should swallow the key. The booth's own operator shortcuts are
 * deliberately *not* in here: they all need Shift, while reload only needs Ctrl, and the
 * DevTools shortcuts are Ctrl+Shift+I/J/C, so no operator hotkey is ever blocked.
 */
export function isBlockedKioskShortcut(input: KioskKeyInput): boolean {
  const key = input.key.toLowerCase();
  // Function keys need no modifier at all, so they are checked first.
  if (key === 'f12' || key === 'f5') return true;
  if (!input.control && !input.meta) return false;
  if (input.shift && DEVTOOLS_KEYS.includes(key)) return true;
  // Reload (Ctrl+R) would restart the booth mid-session; Ctrl+Shift+R is the operator's.
  return !input.shift && key === 'r';
}
