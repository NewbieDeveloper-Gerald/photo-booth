import React from 'react';

type SlotProgressProps = { slotCount: number; currentSlot: number; capturedSlots: ReadonlySet<number> };

/** Numbered chips showing which shots are saved, being taken, or still to come. */
export function SlotProgress({ slotCount, currentSlot, capturedSlots }: SlotProgressProps): React.JSX.Element {
  const slots = Array.from({ length: slotCount }, (_, index) => index + 1);
  return (
    <div className="slot-progress" aria-label="Photo slot progress">
      {slots.map((slot) => {
        const isSaved = capturedSlots.has(slot);
        const isCurrent = currentSlot === slot;
        return (
          <div className={`slot-chip ${isSaved ? 'saved' : isCurrent ? 'current' : ''}`} key={slot}>
            <b>{String(slot).padStart(2, '0')}</b>
            <span>{isSaved ? 'Saved' : isCurrent ? 'Now' : 'Next'}</span>
          </div>
        );
      })}
    </div>
  );
}
