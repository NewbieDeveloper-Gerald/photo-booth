// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsentDialog } from './ConsentDialog';

describe('ConsentDialog', () => {
  it('shows the operator-configured wording', () => {
    render(<ConsentDialog text="Photos stay on this booth." onDecline={vi.fn()} onAccept={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Photos stay on this booth.')).toBeTruthy();
  });

  it('reports the guest decision', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<ConsentDialog text="Text" onDecline={onDecline} onAccept={onAccept} />);
    fireEvent.click(screen.getByText('Agree and continue'));
    fireEvent.click(screen.getByText('Not now'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });
});
