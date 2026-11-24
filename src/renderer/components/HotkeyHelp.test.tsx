// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HotkeyHelp } from './HotkeyHelp';
import { HOTKEYS, hotkeyLabel } from '../lib/hotkeys';

describe('HotkeyHelp (F21)', () => {
  it('lists every operator key with its label, so the help cannot drift from the handler', () => {
    render(<HotkeyHelp onClose={() => {}} />);
    const dialog = screen.getByLabelText('Keyboard shortcuts and PIN help');
    for (const hotkey of HOTKEYS) {
      expect(dialog.textContent).toContain(hotkeyLabel(hotkey));
      expect(dialog.textContent).toContain(hotkey.label);
    }
  });

  it('explains the PIN lockout and closes on request', () => {
    const onClose = vi.fn();
    render(<HotkeyHelp onClose={onClose} />);
    expect(screen.getByLabelText('Keyboard shortcuts and PIN help').textContent).toContain('refused for 60 seconds');
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(onClose).toHaveBeenCalled();
  });
});
