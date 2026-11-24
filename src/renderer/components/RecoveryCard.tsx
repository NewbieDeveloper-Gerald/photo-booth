import React from 'react';
import type { UnfinishedSession } from '../../shared/types/session';

type RecoveryCardProps = {
  session: UnfinishedSession;
  busy: boolean;
  cameraReady: boolean;
  onResume: () => void;
  onDiscard: () => void;
};

/** Offers the interrupted session so saved photos are never stranded. */
export function RecoveryCard({ session, busy, cameraReady, onResume, onDiscard }: RecoveryCardProps): React.JSX.Element {
  return (
    <section className="recovery-card">
      <div>
        <p className="eyebrow">UNFINISHED SESSION</p>
        <strong>
          {session.pendingRetakes ? 'A retake needs finishing' : `${session.capturedSlots} of ${session.totalSlots} photos saved`}
        </strong>
        <span>Your photos are safe on this booth. Resume where you left off or discard this session.</span>
      </div>
      <div className="recovery-actions">
        <button type="button" onClick={onResume} disabled={busy || !cameraReady}>Resume</button>
        <button type="button" className="secondary-button" onClick={onDiscard} disabled={busy}>Discard</button>
      </div>
    </section>
  );
}
