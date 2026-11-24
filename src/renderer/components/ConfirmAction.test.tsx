// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmAction } from './ConfirmAction';

const props = { label: 'Delete event', question: 'Delete this event and all its photos?', confirmLabel: 'Yes, delete', onConfirm: vi.fn() };

describe('ConfirmAction (F15)', () => {
  it('asks before running a destructive action', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction {...props} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: props.question })).toBeDefined();
  });

  it('runs the action only after the confirmation click', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction {...props} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Delete event' })).toBeDefined();
  });

  it('cancels without running anything', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction {...props} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('stays disabled while the booth is busy', () => {
    render(<ConfirmAction {...props} disabled />);
    expect((screen.getByRole('button', { name: 'Delete event' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
