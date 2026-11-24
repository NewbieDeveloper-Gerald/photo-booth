import React, { useState } from 'react';
import { LINK_CHANNEL_LABELS, type LinkChannel, type SendLinkOutcome } from '../../features/sharing';

type SendLinkCardProps = {
  /** The QR picture for the guest link — it stays on screen while the guest types. */
  qrDataUrl: string;
  link: string;
  /** Set by the event (F28): a booth can refuse to send at all. */
  enabled: boolean;
  busy?: boolean;
  /** Sends the link; rejects with the message the guest should read. */
  onSend: (channel: LinkChannel, target: string) => Promise<SendLinkOutcome>;
};

const PLACEHOLDERS: Record<LinkChannel, string> = {
  email: 'you@example.com',
  sms: '+63 917 123 4567',
};

/**
 * The fallback to the QR code (F28): a guest can have the link texted or emailed instead of
 * scanning, while the QR keeps showing. The card never shows the typed address back once sent —
 * only a masked confirmation — and the booth keeps nothing.
 */
export function SendLinkCard({ qrDataUrl, link, enabled, busy = false, onSend }: SendLinkCardProps): React.JSX.Element {
  const [channel, setChannel] = useState<LinkChannel>('email');
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!enabled || sending) return;
    setSending(true);
    setError('');
    setStatus('');
    try {
      const outcome = await onSend(channel, target);
      // The typed value is cleared as soon as it is sent: nothing lingers on the screen either.
      setTarget('');
      setStatus(`Sent to ${outcome.maskedTarget} · ${outcome.detail}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the link. Try again or scan the QR code.');
    } finally { setSending(false); }
  };

  return (
    <section className="recovery-card send-link-card" aria-label="Send the link">
      <div className="send-link-qr">
        {qrDataUrl ? <img src={qrDataUrl} alt="QR code for the guest download link" /> : <span className="queue-note">QR code unavailable</span>}
        <span className="queue-note">Scan this, or have the link sent.</span>
      </div>
      <form className="send-link-form" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">GET THE LINK</p>
        <div className="send-link-channels" role="group" aria-label="Send by">
          {(Object.keys(LINK_CHANNEL_LABELS) as LinkChannel[]).map((option) => (
            <button key={option} type="button" className={`secondary-button ${channel === option ? 'selected' : ''}`}
              aria-pressed={channel === option} onClick={() => { setChannel(option); setError(''); setStatus(''); }} disabled={!enabled || sending}>
              {LINK_CHANNEL_LABELS[option]}
            </button>
          ))}
        </div>
        <label>Send to
          <input aria-label="Send the link to" type={channel === 'email' ? 'email' : 'tel'} inputMode={channel === 'email' ? 'email' : 'tel'}
            autoComplete="off" value={target} placeholder={PLACEHOLDERS[channel]} disabled={!enabled || sending}
            onChange={(event) => setTarget(event.target.value)} />
        </label>
        <button type="submit" className="start-button" disabled={!enabled || sending || busy || !target.trim()}>
          {sending ? 'Sending…' : 'Send link'}
        </button>
        {!enabled && <p className="queue-note">Sending the link is turned off for this event. Scan the QR code to download.</p>}
        {status && <p className="send-link-status" role="status">{status}</p>}
        {error && <p className="pin-error" role="alert">{error}</p>}
        <p className="queue-note">The booth sends the link and keeps nothing: no address or number is stored.</p>
        {link && <input className="remote-link" aria-label="Guest link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />}
      </form>
    </section>
  );
}
