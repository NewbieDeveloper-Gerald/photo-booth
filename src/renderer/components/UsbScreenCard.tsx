import React, { useState } from 'react';
import type { UsbLinkStatus } from '../../features/remote-guest';

type UsbScreenCardProps = {
  status: UsbLinkStatus | null;
  /** The tablet screen has to be switched on before the cable link can serve it. */
  remoteEnabled: boolean;
  busy?: boolean;
  onRefresh: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
};

/**
 * The cable-only tablet screen (F22 extension). It reports the three things that can be wrong —
 * adb missing, no phone on the cable, port not mapped — and does the mapping when asked. Nothing
 * here uses the network: the device opens 127.0.0.1 over the cable.
 */
export function UsbScreenCard({ status, remoteEnabled, busy = false, onRefresh, onConnect, onDisconnect }: UsbScreenCardProps): React.JSX.Element {
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>, message: string): Promise<void> => {
    setWorking(true);
    setError('');
    setNote('');
    try { await action(); setNote(message); } catch (caught) { setError(caught instanceof Error ? caught.message : 'The cable link failed.'); }
    finally { setWorking(false); }
  };

  const connected = Boolean(status?.device && status.portForwarded);
  return (
    <section className="recovery-card usb-screen-card" aria-label="USB cable screen">
      <div>
        <p className="eyebrow">USB CABLE SCREEN</p>
        <strong>{connected ? `Phone on the cable · ${status!.device}` : status?.device ? 'Phone connected, link not set up' : 'No phone on the cable'}</strong>
        <span>
          {status?.reason ?? (connected
            ? 'The tablet screen is open on the phone over the cable. No internet, no router, no QR code.'
            : 'Plug the phone or tablet in, allow USB debugging once, then press Connect.')}
        </span>
        {status?.url && <input className="remote-link" aria-label="USB screen address" readOnly value={status.url} onFocus={(event) => event.currentTarget.select()} />}
        {!remoteEnabled && <span className="queue-note">Switch on the tablet guest screen first; the cable link serves that screen.</span>}
        {status && !status.toolsAvailable && <span className="queue-note">Install Android platform-tools on this computer to use a cable.</span>}
      </div>
      <div className="remote-actions">
        <button type="button" className="secondary-button" onClick={onRefresh} disabled={busy || working}>Check cable</button>
        {connected
          ? <button type="button" className="secondary-button" disabled={busy || working} onClick={() => void run(onDisconnect, 'Cable link closed.')}>Disconnect</button>
          : <button type="button" className="start-button" disabled={busy || working || !remoteEnabled || !status?.device}
            onClick={() => void run(onConnect, 'Screen opened on the phone over the cable.')}>Connect over USB</button>}
      </div>
      {note && <p className="profile-note" role="status">{note}</p>}
      {error && <p className="pin-error" role="alert">{error}</p>}
    </section>
  );
}
