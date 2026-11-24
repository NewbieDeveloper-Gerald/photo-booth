// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterPicker } from './FilterPicker';

describe('FilterPicker (F20)', () => {
  it('offers every look with the selected one pressed', () => {
    render(<FilterPicker selected="warm" onSelect={() => {}} />);
    const group = screen.getByLabelText('Photo filter');
    expect(group.textContent).toContain('Choose a look');
    for (const label of ['Original', 'Black & white', 'Warm', 'Beauty']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Warm' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Original' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the chosen look', () => {
    const onSelect = vi.fn();
    render(<FilterPicker selected="none" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Black & white' }));
    expect(onSelect).toHaveBeenCalledWith('mono');
  });

  it('shows the look in the swatch and disables the choice while the booth is busy', () => {
    render(<FilterPicker selected="none" onSelect={() => {}} disabled />);
    const swatch = screen.getByRole('button', { name: 'Beauty' }).querySelector('.filter-swatch') as HTMLElement;
    expect(swatch.style.filter).toContain('blur(0.6px)');
    expect(screen.getByRole('button', { name: 'Beauty' })).toHaveProperty('disabled', true);
  });
});
