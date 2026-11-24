// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RemoteGuestCard } from './RemoteGuestCard';
import type { RemoteServerInfo } from '../../shared/types/remote-guest';

const info = (overrides: Partial<RemoteServerInfo> = {}): RemoteServerInfo => ({
  enabled: false, url: 'http://192.168.1.24:47626/remote/abcdefghijklmnopqrstuv/', clients: 0, ...overrides,
});

describe('RemoteGuestCard (F22)', () => {
  it('says what turning the screen on does, and shows the link once it is on', () => {
    const { rerender } = render(<RemoteGuestCard info={info()} onToggle={() => {}} onRotate={() => {}} />);
    expect(screen.getByLabelText('Tablet guest screen').textContent).toContain('Tablet screen is off');
    expect(screen.queryByLabelText('Tablet link')).toBeNull();
    rerender(<RemoteGuestCard info={info({ enabled: true })} onToggle={() => {}} onRotate={() => {}} />);
    const link = screen.getByLabelText('Tablet link') as HTMLInputElement;
    expect(link.value).toBe('http://192.168.1.24:47626/remote/abcdefghijklmnopqrstuv/');
    expect(link.readOnly).toBe(true);
    expect(screen.getByLabelText('Tablet guest screen').textContent).toContain('No tablet connected yet.');
  });

  it('counts the tablets that are watching', () => {
    render(<RemoteGuestCard info={info({ enabled: true, clients: 2 })} onToggle={() => {}} onRotate={() => {}} />);
    expect(screen.getByLabelText('Tablet guest screen').textContent).toContain('2 tablets are connected.');
    render(<RemoteGuestCard info={info({ enabled: true, clients: 1 })} onToggle={() => {}} onRotate={() => {}} />);
    expect(screen.getAllByLabelText('Tablet guest screen').at(-1)!.textContent).toContain('1 tablet is connected.');
  });

  it('switches on, switches off and mints a new link', () => {
    const onToggle = vi.fn();
    const onRotate = vi.fn();
    const { rerender } = render(<RemoteGuestCard info={info()} onToggle={onToggle} onRotate={onRotate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch on' }));
    expect(onToggle).toHaveBeenCalledWith(true);
    rerender(<RemoteGuestCard info={info({ enabled: true })} onToggle={onToggle} onRotate={onRotate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch off' }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'New link' }));
    expect(onRotate).toHaveBeenCalled();
  });

  it('explains a missing network address and any failure', () => {
    const { rerender } = render(<RemoteGuestCard info={info({ enabled: true, url: null })} onToggle={() => {}} onRotate={() => {}} />);
    expect(screen.getByLabelText('Tablet guest screen').textContent).toContain('No network address found');
    rerender(<RemoteGuestCard info={info({ enabled: true })} error="Could not make a new link." onToggle={() => {}} onRotate={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Could not make a new link.');
  });
});
