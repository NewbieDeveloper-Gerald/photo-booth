import React, { useState } from 'react';

type AnalyticsCardProps = {
  /** The public HTTPS origin when the operator configured one, otherwise '' for the local link. */
  downloadBaseUrl: string;
  /** The address the booth's own web server listens on. */
  localOrigin?: string;
};

/**
 * Where the operator finds the numbers (F24). The dashboard lives on the booth's web server and
 * asks for the admin PIN, so the card only has to hand over the address — over the tunnel when
 * the operator configured one, locally otherwise.
 */
export function AnalyticsCard({ downloadBaseUrl, localOrigin = 'http://127.0.0.1:47625' }: AnalyticsCardProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const base = downloadBaseUrl.trim() || localOrigin;
  const dashboardUrl = `${base.replace(/\/+$/, '')}/admin`;
  const remote = Boolean(downloadBaseUrl.trim());

  const copy = async (): Promise<void> => {
    if (!navigator.clipboard) return;
    try { await navigator.clipboard.writeText(dashboardUrl); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <section className="recovery-card analytics-card" aria-label="Booth numbers">
      <div>
        <p className="eyebrow">BOOTH NUMBERS</p>
        <strong>Sessions, photos, retakes, prints and downloads per event</strong>
        <span>
          Open this on a phone or laptop and sign in with the admin PIN. The CSV button on that page
          downloads the same numbers for a spreadsheet.
        </span>
        <input className="remote-link" aria-label="Dashboard link" readOnly value={dashboardUrl} onFocus={(event) => event.target.select()} />
        {!remote && <span className="queue-note">
          This is the address on the booth computer. Set the public HTTPS download URL above to read the
          numbers from a phone over the same tunnel the guest links use.
        </span>}
      </div>
      <div className="remote-actions">
        <a className="secondary-button" href={dashboardUrl} target="_blank" rel="noreferrer">Open dashboard</a>
        <button type="button" className="secondary-button" disabled={!navigator.clipboard} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </section>
  );
}
