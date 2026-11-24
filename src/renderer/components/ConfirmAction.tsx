import React, { useState } from 'react';

type ConfirmActionProps = {
  /** Button text before it is clicked, e.g. "Delete event". */
  label: string;
  /** The question shown once clicked, e.g. "Delete this event and its photos?". */
  question: string;
  /** Confirm button text, e.g. "Yes, delete". */
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Two-step destructive action: deletions of sessions and events cannot be undone, so the
 * first click only asks, and cancelling costs nothing.
 */
export function ConfirmAction({ label, question, confirmLabel, onConfirm, disabled = false, className = 'secondary-button' }: ConfirmActionProps): React.JSX.Element {
  const [isConfirming, setIsConfirming] = useState(false);
  if (!isConfirming) {
    return (
      <button type="button" className={className} onClick={() => setIsConfirming(true)} disabled={disabled}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-action" role="group" aria-label={question}>
      <span className="confirm-question">{question}</span>
      <button type="button" className="danger-button" onClick={() => { setIsConfirming(false); onConfirm(); }}>
        {confirmLabel}
      </button>
      <button type="button" className={className} onClick={() => setIsConfirming(false)}>Cancel</button>
    </span>
  );
}
