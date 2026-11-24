import React, { useState } from 'react';
import type { RemoteServerInfo } from '../../shared/types/remote-guest';

type RemoteGuestCardProps = {
  info: RemoteServerInfo | null;
  onToggle: (enabled: boolean) => void;
  onRotate: () => void;
  busy?: boolean;
  /** Shown under the link when the operator needs to know why it did nothing. */
  error?: string;
};

/**
 * The operator's half of the tablet screen (F22): one switch, one link, and how many tablets
 * are watching. The link is the only way in, so rotating it is the way to kick a device out.
 */
export function RemoteGuestCard({ info, onToggle, onRotate, busy = false, error = '' }: RemoteGuestCardProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const enabled = info?.enabled ?? false;
  const url = info?.url ?? '';
  const clients = info?.clients ?? 0;

  const copy = async (): Promise<void> => {
    if (!url || !navigator.clipboard) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <section className="recovery-card remote-card" aria-label="Tablet guest screen">
      <div>
        <p className="eyebrow">TABLET GUEST SCREEN</p>
        <strong>{enabled ? 'Open on a tablet on the same Wi-Fi' : 'Tablet screen is off'}</strong>
        <span>
          {enabled
            ? 'The camera and printer stay on this computer. The tablet only shows the preview and the buttons.'
            : 'Turn it on to get a link for a tablet. Nothing is served until you do.'}
        </span>
        {enabled && (url
          ? <input className="remote-link" aria-label="Tablet link" readOnly value={url} onFocus={(event) => event.target.select()} />
          : <span className="queue-error">No network address found. Connect this computer to the Wi-Fi guests will use, then reopen this panel.</span>)}
        {enabled && <span className="queue-note">
          {clients === 0 ? 'No tablet connected yet.' : `${clients} ${clients === 1 ? 'tablet is' : 'tablets are'} connected.`}
          {' '}The link is the only way in; a new link locks out any tablet still holding the old one.
        </span>}
        {error && <span className="queue-error" role="alert">{error}</span>}
      </div>
      <div className="remote-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => onToggle(!enabled)}>
          {enabled ? 'Switch off' : 'Switch on'}
        </button>
        {url && <button type="button" className="secondary-button" disabled={busy || !navigator.clipboard} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={onRotate}>New link</button>
      </div>
    </section>
  );
}
