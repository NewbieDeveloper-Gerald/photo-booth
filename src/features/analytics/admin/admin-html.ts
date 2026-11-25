import { escapeHtml } from '../../../shared/validation/html';
import { formatDuration } from '../domain/stats';
import type { BoothStats } from '../../../shared/types/analytics';

/**
 * The dashboard pages (F24). Plain HTML with inline styles: they are read on a laptop in the
 * venue, they must work with no build step, and one of them asks for the admin PIN.
 */
export const ADMIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const STYLES = `
  *{box-sizing:border-box}body{margin:0;background:#f7f6f3;color:#1b1a17;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:1080px;margin:auto;padding:28px 18px 56px}
  h1{font-size:26px;margin:0 0 6px}h2{font-size:15px;margin:26px 0 8px;letter-spacing:.08em;text-transform:uppercase;color:#6b6861}
  .eyebrow{color:#1b1a17;font-size:11px;letter-spacing:.16em;font-weight:700;text-transform:uppercase}
  .note{color:#6b6861;font-size:13px}
  table{width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;overflow:hidden}
  th,td{padding:10px 12px;text-align:right;border-bottom:1px solid #e7e4dd;font-variant-numeric:tabular-nums}
  th:first-child,td:first-child{text-align:left}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b6861;font-weight:700}
  tr:last-child td{border-bottom:0}
  tfoot td{background:#f1efe9;font-weight:700}
  .card{background:#ffffff;border:1px solid #e7e4dd;border-radius:14px;padding:18px;margin:18px 0}
  input{width:100%;padding:12px;border-radius:9px;border:1px solid #d2cec3;background:#ffffff;color:#1b1a17;font:inherit;font-size:18px;letter-spacing:.35em}
  button,.link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border:0;border-radius:9px;background:#1b1a17;color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
  button.ghost,.link.ghost{background:#ffffff;border:1px solid #d2cec3;color:#1b1a17}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
  .error{color:#a8232a;margin:10px 0 0}
  form{margin:0}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive">
<title>${escapeHtml(title)}</title><style>${STYLES}</style></head><body><main class="wrap">${body}</main></body></html>`;
}

/** The login is the same admin PIN as the booth, so the lockout from F21 protects it too. */
export function renderAdminLogin(error = ''): string {
  return page('Booth numbers · sign in', `
    <p class="eyebrow">PHOTOBOOTH STUDIO · OPERATOR</p>
    <h1>Booth numbers</h1>
    <p class="note">Sign in with the booth's admin PIN. Five wrong tries lock the PIN for a minute.</p>
    <form class="card" method="post" action="login">
      <label for="pin">Admin PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus minlength="6" maxlength="12" pattern="[0-9]{6,12}" required>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      <p><button type="submit">Sign in</button></p>
    </form>
    <p class="note">Numbers come from this booth's own records: sessions, photos, retakes, printed sheets and guest downloads. Nothing leaves the computer.</p>
  `);
}

function number(value: number): string {
  return value.toLocaleString('en-US');
}

/** Per-event table, a totals row, the CSV link and a way out. */
export function renderAdminDashboard(stats: BoothStats): string {
  const rows = stats.events.map((row) => `<tr>
      <td>${escapeHtml(row.eventName)}</td>
      <td>${number(row.sessions)}</td>
      <td>${number(row.photos)}</td>
      <td>${number(row.retakes)}</td>
      <td>${number(row.prints)}</td>
      <td>${number(row.downloads)}</td>
      <td>${formatDuration(row.averageSessionSeconds)}</td>
    </tr>`).join('');
  const totals = stats.totals;
  return page('Booth numbers', `
    <div class="row">
      <div>
        <p class="eyebrow">PHOTOBOOTH STUDIO · OPERATOR</p>
        <h1>Booth numbers</h1>
        <p class="note">Generated ${escapeHtml(new Date(stats.generatedAt).toLocaleString())} · ${number(totals.events)} ${totals.events === 1 ? 'event' : 'events'} · ${number(totals.sessions)} finished ${totals.sessions === 1 ? 'session' : 'sessions'}</p>
      </div>
      <div class="row">
        <a class="link" href="numbers.csv">Download CSV</a>
        <form method="post" action="logout"><button class="ghost" type="submit">Sign out</button></form>
      </div>
    </div>
    ${stats.events.length === 0 ? '<p class="card">No events yet. Save an event and run a session, then reload this page.</p>' : `
    <table>
      <thead><tr><th>Event</th><th>Sessions</th><th>Photos</th><th>Retakes</th><th>Prints</th><th>Downloads</th><th>Avg session</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>All events</td><td>${number(totals.sessions)}</td><td>${number(totals.photos)}</td><td>${number(totals.retakes)}</td><td>${number(totals.prints)}</td><td>${number(totals.downloads)}</td><td>${formatDuration(totals.averageSessionSeconds)}</td></tr></tfoot>
    </table>`}
    <p class="note">Sessions count finished sessions; photos include retaken shots; retakes are the session counter; prints are sheets the printer reported done; downloads are guest file and ZIP hits. The CSV has the same numbers, with the average in seconds as well.</p>
  `);
}

export function renderAdminError(message: string): string {
  return page('Booth numbers', `
    <p class="eyebrow">PHOTOBOOTH STUDIO · OPERATOR</p>
    <h1>Not available</h1>
    <p class="note">${escapeHtml(message)}</p>
    <p><a class="link ghost" href=".">Back to the sign-in page</a></p>
  `);
}
