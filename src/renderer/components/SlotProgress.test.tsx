// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlotProgress } from './SlotProgress';

describe('SlotProgress', () => {
  it('labels saved, current and upcoming shots', () => {
    render(<SlotProgress slotCount={3} currentSlot={2} capturedSlots={new Set([1])} />);
    expect(screen.getAllByText('Saved')).toHaveLength(1);
    expect(screen.getAllByText('Now')).toHaveLength(1);
    expect(screen.getAllByText('Next')).toHaveLength(1);
  });

  it('numbers the chips with two digits', () => {
    render(<SlotProgress slotCount={12} currentSlot={1} capturedSlots={new Set()} />);
    expect(screen.getByText('12')).toBeTruthy();
  });
});
