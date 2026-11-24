// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateSummary } from '../../features/layouts';
import { MAX_OFFERED_LAYOUTS } from '../../shared/constants/limits';
import { GuestLayoutField } from './GuestLayoutField';

function templates(count: number): TemplateSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `layout-${index + 1}`, name: `Layout ${index + 1}`, shots: (index % 6) + 1, copies: 1, pagePreset: '4x6' as const, pageLabel: '4 × 6 in', builtIn: true,
  }));
}

describe('GuestLayoutField (F13)', () => {
  it('always offers the event’s default layout and locks that row', () => {
    render(<GuestLayoutField templates={templates(3)} defaultLayoutId="layout-1" offeredLayoutIds={['layout-1']} onChange={vi.fn()} />);
    const box = screen.getByLabelText('Offer Layout 1') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it('ticks layouts the event already offers', () => {
    render(<GuestLayoutField templates={templates(3)} defaultLayoutId="layout-1" offeredLayoutIds={['layout-1', 'layout-3']} onChange={vi.fn()} />);
    expect((screen.getByLabelText('Offer Layout 3') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Offer Layout 2') as HTMLInputElement).checked).toBe(false);
  });

  it('adds a layout when the operator ticks it', () => {
    const onChange = vi.fn();
    render(<GuestLayoutField templates={templates(3)} defaultLayoutId="layout-1" offeredLayoutIds={['layout-1']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Offer Layout 2'));
    expect(onChange).toHaveBeenCalledWith(['layout-1', 'layout-2']);
  });

  it('removes a layout when the operator unticks it', () => {
    const onChange = vi.fn();
    render(<GuestLayoutField templates={templates(3)} defaultLayoutId="layout-1" offeredLayoutIds={['layout-1', 'layout-2', 'layout-3']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Offer Layout 3'));
    expect(onChange).toHaveBeenCalledWith(['layout-1', 'layout-2']);
  });

  it('stops at the maximum number of offered layouts', () => {
    const all = templates(MAX_OFFERED_LAYOUTS + 1);
    render(<GuestLayoutField templates={all} defaultLayoutId="layout-1" offeredLayoutIds={all.slice(0, MAX_OFFERED_LAYOUTS).map((item) => item.id)} onChange={vi.fn()} />);
    expect((screen.getByLabelText(`Offer Layout ${MAX_OFFERED_LAYOUTS + 1}`) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Offer Layout 2') as HTMLInputElement).disabled).toBe(false);
  });

  it('names the photo count and the default row', () => {
    render(<GuestLayoutField templates={templates(2)} defaultLayoutId="layout-2" offeredLayoutIds={['layout-2']} onChange={vi.fn()} />);
    const label = screen.getByLabelText('Offer Layout 2').closest('label');
    expect(label?.textContent).toContain('default');
    expect(screen.getByLabelText('Offer Layout 1').closest('label')?.textContent).toContain('1 photo');
  });
});
