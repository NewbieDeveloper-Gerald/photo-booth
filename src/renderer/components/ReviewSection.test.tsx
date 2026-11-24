// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionRecord, SessionSlot } from '../../shared/types/session';
import { ReviewSection } from './ReviewSection';

function slot(slotNumber: number, overrides: Partial<SessionSlot> = {}): SessionSlot {
  return {
    slotNumber,
    status: 'captured',
    photoId: `photo-${slotNumber}`,
    previousPhotoId: null,
    pendingPhotoId: null,
    downloadReady: true,
    hasPrevious: false,
    pendingDownloadReady: false,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    eventId: 'event-1',
    eventName: 'Wedding',
    layoutId: 'double-strip-3',
    status: 'review',
    retakesUsed: 0,
    retakeLimit: 2,
    slots: [slot(1), slot(2), slot(3)],
    ...overrides,
  };
}

describe('ReviewSection', () => {
  it('shows the remaining retake allowance', () => {
    render(<ReviewSection record={session({ retakesUsed: 1 })} images={[]} isBusy={false} cameraReady onRetake={vi.fn()} onRevert={vi.fn()} />);
    expect(screen.getByText('1 retakes left')).toBeTruthy();
  });

  it('says unlimited when the limit is -1', () => {
    render(<ReviewSection record={session({ retakeLimit: -1 })} images={[]} isBusy={false} cameraReady onRetake={vi.fn()} onRevert={vi.fn()} />);
    expect(screen.getByText('Unlimited retakes')).toBeTruthy();
  });

  it('reports a retake per photo and disables it once the limit is spent', () => {
    const onRetake = vi.fn();
    const record = session({ retakesUsed: 2, retakeLimit: 2 });
    render(<ReviewSection record={record} images={[]} isBusy={false} cameraReady onRetake={onRetake} onRevert={vi.fn()} />);
    const retakeButtons = screen.getAllByText('Retake') as HTMLButtonElement[];
    expect(retakeButtons).toHaveLength(3);
    expect(retakeButtons.every((button) => button.disabled)).toBe(true);
    fireEvent.click(retakeButtons[0]!);
    expect(onRetake).not.toHaveBeenCalled();
  });

  it('offers to finish a saved retake even when the limit is spent', () => {
    const onRetake = vi.fn();
    const record = session({ retakesUsed: 2, retakeLimit: 2, slots: [slot(1, { pendingPhotoId: 'pending-1' }), slot(2), slot(3)] });
    render(<ReviewSection record={record} images={[]} isBusy={false} cameraReady onRetake={onRetake} onRevert={vi.fn()} />);
    fireEvent.click(screen.getByText('Finish saved retake'));
    expect(onRetake).toHaveBeenCalledWith(expect.objectContaining({ slotNumber: 1 }));
  });

  it('lets the operator restore a previous photo only when one exists', () => {
    const onRevert = vi.fn();
    const record = session({ slots: [slot(1, { previousPhotoId: 'old-1', hasPrevious: true }), slot(2), slot(3)] });
    render(<ReviewSection record={record} images={[]} isBusy={false} cameraReady onRetake={vi.fn()} onRevert={onRevert} />);
    const revertButtons = screen.getAllByText('Use previous photo') as HTMLButtonElement[];
    expect(revertButtons[0]!.disabled).toBe(false);
    expect(revertButtons[1]!.disabled).toBe(true);
    fireEvent.click(revertButtons[0]!);
    expect(onRevert).toHaveBeenCalledWith(expect.objectContaining({ slotNumber: 1 }));
  });
});
