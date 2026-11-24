import React from 'react';

type ConsentDialogProps = { text: string; onDecline: () => void; onAccept: () => void };

/** Shown before every session; the operator can edit the wording in settings. */
export function ConsentDialog({ text, onDecline, onAccept }: ConsentDialogProps): React.JSX.Element {
  return (
    <div className="modal-backdrop">
      <section className="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consent-heading">
        <p className="eyebrow">BEFORE WE TAKE A PHOTO</p>
        <h2 id="consent-heading">Please read and agree</h2>
        <p className="consent-copy">{text}</p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onDecline}>Not now</button>
          <button type="button" className="start-button" onClick={onAccept}>Agree and continue</button>
        </div>
      </section>
    </div>
  );
}
