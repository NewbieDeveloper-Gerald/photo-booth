// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttractMediaField } from './AttractMediaField';
import type { AttractMedia } from '../../shared/types/attract';

const media = (overrides: Partial<AttractMedia> = {}): AttractMedia =>
  ({ id: 'party-1234abcd.png', kind: 'image', label: 'party.png', bytes: 2 * 1024 * 1024, ...overrides });

describe('AttractMediaField (F19)', () => {
  it('explains what the loop shows when no media is set', () => {
    render(<AttractMediaField media={[]} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/the idle loop shows this event's layouts/)).toBeTruthy();
  });

  it('lists photos and clips with their size', () => {
    render(<AttractMediaField media={[media(), media({ id: 'clip-1234abcd.mp4', kind: 'video', label: 'clip.mp4', bytes: 6 * 1024 * 1024 })]} onAdd={() => {}} onRemove={() => {}} />);
    const list = screen.getByLabelText('Attract screen files');
    expect(list.textContent).toContain('party.png');
    expect(list.textContent).toContain('2.0 MB');
    expect(list.textContent).toContain('clip.mp4');
    expect(list.textContent).toContain('VIDEO');
    expect(screen.getByText('2 of 8 files', { exact: false })).toBeTruthy();
  });

  it('adds and removes through the buttons it is given', () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<AttractMediaField media={[media()]} onAdd={onAdd} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add photos or video' }));
    expect(onAdd).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove party.png' }));
    expect(onRemove).toHaveBeenCalledWith('party-1234abcd.png');
  });

  it('stops adding once the file cap is reached', () => {
    const full = Array.from({ length: 8 }, (_, index) => media({ id: `photo-${index}-1234abcd.png`, label: `photo-${index}.png` }));
    render(<AttractMediaField media={full} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add photos or video' })).toHaveProperty('disabled', true);
  });

  it('is disabled while the booth is busy', () => {
    render(<AttractMediaField media={[media()]} busy onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add photos or video' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Remove party.png' })).toHaveProperty('disabled', true);
  });
});
