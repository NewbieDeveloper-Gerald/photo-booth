import React from 'react';

type ExitDialogProps = {
  pin: string;
  error: string;
  onPinChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/** Closing the kiosk needs the admin PIN; a wrong PIN keeps the booth locked. */
export function ExitDialog({ pin, error, onPinChange, onCancel, onSubmit }: ExitDialogProps): React.JSX.Element {
  return (
    <div className="modal-backdrop">
      <section className="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-heading">
        <p className="eyebrow">ADMIN AUTHORIZATION</p>
        <h2 id="exit-heading">Exit booth?</h2>
        <p>Enter the admin PIN to close Boothwright.</p>
        <label>
          Admin PIN
          <input
            aria-label="Admin PIN to exit booth"
            type="password"
            inputMode="numeric"
            maxLength={12}
            autoComplete="current-password"
            value={pin}
            onChange={(event) => onPinChange(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onSubmit}>Verify and exit</button>
        </div>
        {error && <p className="pin-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
