import React from 'react';
import { canRetake, cssPhotoFilter, retakesRemaining } from '../../features/capture';
import type { SessionRecord, SessionSlot } from '../../shared/types/session';

export type ReviewImage = { slotNumber: number; photoId: string; url: string };

type ReviewSectionProps = {
  record: SessionRecord;
  images: ReviewImage[];
  isBusy: boolean;
  cameraReady: boolean;
  onRetake: (slot: SessionSlot) => void;
  onRevert: (slot: SessionSlot) => void;
};

/** Retake or revert one photo without touching the others; the limit counts across the session. */
export function ReviewSection({ record, images, isBusy, cameraReady, onRetake, onRevert }: ReviewSectionProps): React.JSX.Element {
  const remaining = retakesRemaining(record.retakeLimit, record.retakesUsed);
  // The thumbnails show the look the print will have; the files on disk stay clean (F20).
  const look = cssPhotoFilter(record.filterId);
  const allowed = canRetake(record.retakeLimit, record.retakesUsed);
  return (
    <section className="review-section">
      <div className="review-summary">
        <strong>{remaining === null ? 'Unlimited retakes' : `${remaining} retakes left`}</strong>
        <span>{record.retakesUsed} used · limit applies across all session photos{record.filterId === 'none' ? '' : ' · look applied to the print and downloads'}</span>
      </div>
      <div className="review-grid">
        {record.slots.map((slot) => {
          const image = images.find((item) => item.slotNumber === slot.slotNumber);
          return (
            <article className="review-slot" key={slot.slotNumber}>
              <div className="review-image">
                {image ? <img src={image.url} alt={`Photo ${slot.slotNumber}`} style={look === 'none' ? undefined : { filter: look }} /> : <span>Photo not available</span>}
                <b>PHOTO {slot.slotNumber}</b>
              </div>
              <div className="review-actions">
                {slot.pendingPhotoId
                  ? <button type="button" onClick={() => onRetake(slot)} disabled={isBusy}>Finish saved retake</button>
                  : <button type="button" onClick={() => onRetake(slot)} disabled={!allowed || !cameraReady || isBusy}>Retake</button>}
                <button type="button" className="revert-button" onClick={() => onRevert(slot)} disabled={!slot.previousPhotoId || isBusy}>
                  Use previous photo
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
