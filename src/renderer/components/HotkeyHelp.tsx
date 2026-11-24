import React from 'react';
import { HOTKEYS, hotkeyLabel } from '../lib/hotkeys';
import { MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS } from '../../features/security/domain/pin-lockout';

type HotkeyHelpProps = {
  onClose: () => void;
};

/**
 * The help screen (F21): one row per operator key, plus how the PIN lockout behaves. It reads
 * the same list the keyboard handler uses, so it cannot promise a key that does nothing.
 */
export function HotkeyHelp({ onClose }: HotkeyHelpProps): React.JSX.Element {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts and PIN help">
      <div className="hotkey-help">
        <p className="eyebrow">OPERATOR HELP</p>
        <h2>Keyboard shortcuts</h2>
        <p className="hotkey-hint">Every shortcut needs Ctrl and Shift together, so guests cannot trigger one by accident.</p>
        <ul className="hotkey-list">
          {HOTKEYS.map((hotkey) => (
            <li key={hotkey.action}>
              <kbd>{hotkeyLabel(hotkey)}</kbd>
              <span className="hotkey-label">{hotkey.label}</span>
              <span className="hotkey-description">{hotkey.description}</span>
            </li>
          ))}
        </ul>
        <p className="hotkey-hint">
          The admin PIN is checked {MAX_PIN_ATTEMPTS} times, then refused for {Math.round(PIN_LOCKOUT_MS / 1000)} seconds.
          A correct PIN clears the count, and the booth never stores the PIN itself.
        </p>
        <button type="button" className="start-button" onClick={onClose}>Close help</button>
      </div>
    </div>
  );
}
