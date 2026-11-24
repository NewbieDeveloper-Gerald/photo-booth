// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { layoutPresets, templateFromCatalogPreset, type TemplateSummary } from '../../features/layouts';
import { LayoutPicker, type LayoutChoice } from './LayoutPicker';

function choice(index: number): LayoutChoice {
  const document = templateFromCatalogPreset(layoutPresets[index]!);
  const summary: TemplateSummary = { id: document.id, name: document.name, shots: document.shots, copies: document.copies, pagePreset: document.page.id, pageLabel: document.page.label, builtIn: true };
  return { summary, document };
}

describe('LayoutPicker (F13)', () => {
  it('steps out of the flow when the event offers a single layout', () => {
    render(<LayoutPicker choices={[choice(0)]} selectedId={choice(0).summary.id} onSelect={vi.fn()} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText('Choose your layout')).toBeNull();
  });

  it('shows every offered layout as a large preview card', () => {
    const choices = [choice(0), choice(1), choice(2)];
    render(<LayoutPicker choices={choices} selectedId={choices[0]!.summary.id} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    for (const { summary } of choices) {
      expect(screen.getByText(summary.name)).toBeDefined();
      expect(screen.getByRole('img', { name: `${summary.name} preview` })).toBeDefined();
    }
  });

  it('marks the chosen layout and reports a new choice', () => {
    const choices = [choice(0), choice(1)];
    const onSelect = vi.fn();
    render(<LayoutPicker choices={choices} selectedId={choices[0]!.summary.id} onSelect={onSelect} />);
    expect(screen.getByRole('radio', { name: new RegExp(choices[0]!.summary.name) }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(choices[1]!.summary.name) }));
    expect(onSelect).toHaveBeenCalledWith(choices[1]!.summary.id);
  });

  it('says how many photos the chosen layout takes', () => {
    const multi = choice(1);
    render(<LayoutPicker choices={[choice(0), multi]} selectedId={multi.summary.id} onSelect={vi.fn()} />);
    expect(screen.getByRole('radio', { name: new RegExp(multi.summary.name) }).textContent).toContain(`${multi.summary.shots} photos`);
  });

  it('falls back to the page label when a layout preview cannot be loaded', () => {
    const fallback: LayoutChoice = { summary: { id: 'custom-1', name: 'Sponsor card', shots: 2, copies: 1, pagePreset: '4x6', pageLabel: '4 × 6 in', builtIn: false }, document: null };
    render(<LayoutPicker choices={[choice(0), fallback]} selectedId={fallback.summary.id} onSelect={vi.fn()} />);
    expect(screen.getByText('4 × 6 in')).toBeDefined();
  });

  it('blocks new choices while the booth is busy', () => {
    const choices = [choice(0), choice(1)];
    render(<LayoutPicker choices={choices} selectedId={choices[0]!.summary.id} onSelect={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLButtonElement).disabled).toBe(true);
  });
});
