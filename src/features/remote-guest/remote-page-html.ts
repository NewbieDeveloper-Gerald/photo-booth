/**
 * The tablet page (F22). It is served by the booth and deliberately tiny: no build step, no
 * framework, no third-party origin. All it does is keep a WebSocket to the booth, show the
 * streamed preview and turn touches into whitelisted commands.
 */
export type RemotePageOptions = {
  /** Base path of this screen, e.g. `/remote/<token>/`; every URL below is relative to it. */
  eventName: string;
};

export function renderRemotePage(options: RemotePageOptions): string {
  const title = options.eventName ? `${escapeHtml(options.eventName)} · Photo booth` : 'Photo booth';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f7f6f3">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>${title}</title>
<style>
  :root { --page:#f7f6f3; --card:#ffffff; --inset:#f1efe9; --stage:#121212; --ink:#1b1a17; --ink-soft:#43413c;
    --ink-muted:#6b6861; --primary:#1b1a17; --accent:#eae7e0; --line:#e7e4dd; --line-strong:#d2cec3; --accent:#eae7e0; color-scheme: light; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; flex-direction: column; min-height: 100dvh; gap: 0;
    background: var(--page); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    touch-action: manipulation; overscroll-behavior: none;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 18px 10px; }
  header img { max-height: 40px; max-width: 40vw; object-fit: contain; }
  header .name { font-size: 15px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; opacity: .9; margin: 0; }
  main { flex: 1; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 14px; padding: 0 18px 18px; min-height: 0; }
  .stage { position: relative; border-radius: 18px; overflow: hidden; background: var(--stage); border: 1px solid var(--line); min-height: 0; display: grid; place-items: center; }
  .preview { width: 100%; height: 100%; object-fit: cover; display: block; }
  .stage-overlay { position: absolute; inset: 0; display: grid; place-items: center; padding: 18px; text-align: center; background: #141414d9; }
  .stage-overlay[hidden] { display: none; }
  .countdown { font-size: clamp(72px, 22vw, 190px); font-weight: 800; line-height: 1; color: #fff; text-shadow: 0 8px 40px #000a; }
  .headline { font-size: clamp(20px, 3.4vw, 30px); font-weight: 700; margin: 0 0 6px; }
  .sub { margin: 0; font-size: 15px; line-height: 1.45; color: var(--ink-muted); max-width: 46ch; }
  .actions { display: grid; gap: 12px; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  button {
    min-height: 62px; border-radius: 14px; border: 0; padding: 14px 18px; font: inherit; font-size: 18px; font-weight: 700;
    color: var(--ink); background: var(--inset); border: 1px solid var(--line-strong); cursor: pointer; touch-action: manipulation;
  }
  button:disabled { opacity: .45; }
  button.primary { background: var(--primary); color: #fff; border-color: var(--primary); }
  button.accent { background: var(--accent); color: var(--ink); }
  button.ghost { background: var(--card); border: 1px solid var(--line-strong); }
  button.danger { background: #a8232a; color: #fff; border-color: #a8232a; }
  .slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
  .slot { display: grid; gap: 8px; padding: 10px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); text-align: center; }
  .slot span { font-size: 13px; color: var(--ink-muted); }
  .slot button { min-height: 48px; font-size: 15px; }
  .notice { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--inset); font-size: 14px; line-height: 1.5; color: var(--ink-soft); max-height: 32vh; overflow: auto; }
  .share { display: block; margin-top: 10px; font-size: 15px; color: var(--ink-soft); text-decoration: underline; word-break: break-all; }
  .conn { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #fbf2de; color: #8a5a00; font-weight: 700; text-align: center; font-size: 15px; }
  .conn[hidden] { display: none; }
  .stream-warning { margin: 0; font-size: 14px; color: var(--danger, #a8232a); }
  @media (min-width: 900px) { main { grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr); grid-template-rows: minmax(0, 1fr); } .actions { align-content: end; overflow: auto; } }
</style>
</head>
<body>
<header>
  <img id="logo" alt="" hidden>
  <p class="name" id="event-name">Photo booth</p>
</header>
<main>
  <section class="stage" aria-live="polite">
    <img class="preview" id="preview" alt="Live camera preview from the booth">
    <div class="stage-overlay" id="stage-overlay">
      <div>
        <p class="countdown" id="countdown" hidden></p>
        <h1 class="headline" id="headline">Connecting to the booth…</h1>
        <p class="sub" id="sub">Keep this page open; the booth does the work.</p>
        <p class="stream-warning" id="stream-warning" hidden></p>
      </div>
    </div>
  </section>
  <section class="actions" id="actions">
    <p class="notice" id="notice" hidden></p>
    <div class="slots" id="slots"></div>
    <div class="row" id="buttons"></div>
    <p class="share" id="share" hidden></p>
  </section>
</main>
<div class="conn" id="conn" hidden>Reconnecting to the booth…</div>
<script src="app.js"></script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

/**
 * The tablet's behaviour. Plain script so it runs from the booth's own origin with a strict
 * CSP; every command it can send is one the booth's command gate accepts for that stage.
 */
export const REMOTE_APP_JS = `(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var socket = null;
  var retryDelay = 1000;
  var retryTimer = null;
  var view = null;
  var lastCommandAt = 0;

  function send(type, extra) {
    // One touch per 600 ms: a double tap must not start two sessions.
    var now = Date.now();
    if (!socket || socket.readyState !== 1 || now - lastCommandAt < 600) return;
    lastCommandAt = now;
    var command = { type: type };
    if (extra) for (var key in extra) command[key] = extra[key];
    socket.send(JSON.stringify(command));
  }

  function setConnection(connected) {
    el('conn').hidden = connected;
  }

  function renderCountdown(value) {
    var node = el('countdown');
    if (value === null || value === undefined) { node.hidden = true; node.textContent = ''; return; }
    node.hidden = false;
    node.textContent = String(value);
  }

  function button(label, className, onClick, disabled) {
    var node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.className = className;
    node.disabled = Boolean(disabled);
    node.addEventListener('click', onClick);
    return node;
  }

  function render(viewData) {
    view = viewData;
    document.documentElement.style.setProperty('--primary', viewData.primaryColor || '#1b1a17');
    document.documentElement.style.setProperty('--accent', viewData.accentColor || '#eae7e0');
    el('event-name').textContent = viewData.eventName || 'Photo booth';
    var logo = el('logo');
    if (viewData.logoUrl) { logo.hidden = false; logo.src = viewData.logoUrl; } else { logo.hidden = true; logo.removeAttribute('src'); }
    el('headline').textContent = viewData.stage === 'ready' ? (viewData.welcomeText || 'Ready when you are') : (viewData.stage === 'finished' ? (viewData.thankYouText || 'Thank you!') : (viewData.message || ''));
    el('sub').textContent = viewData.stage === 'ready' || viewData.stage === 'finished' ? viewData.message : '';
    renderCountdown(viewData.stage === 'capturing' ? viewData.countdown : null);
    el('stage-overlay').hidden = viewData.stage === 'capturing' && viewData.countdown !== null;

    var notice = el('notice');
    if (viewData.stage === 'consent') {
      notice.hidden = false;
      notice.textContent = viewData.consentText || 'Photos stay on the booth, and the private link to them expires.';
    } else { notice.hidden = true; }

    var share = el('share');
    if (viewData.stage === 'finished' && viewData.shareUrl) {
      share.hidden = false;
      share.textContent = '';
      var link = document.createElement('a');
      link.href = viewData.shareUrl;
      link.textContent = 'Open your photos';
      share.appendChild(link);
    } else { share.hidden = true; }

    var slots = el('slots');
    slots.textContent = '';
    if (viewData.stage === 'review') {
      viewData.slots.forEach(function (slot) {
        var card = document.createElement('div');
        card.className = 'slot';
        var label = document.createElement('span');
        label.textContent = slot.filled ? 'Photo ' + slot.slotNumber : 'Photo ' + slot.slotNumber + ' pending';
        card.appendChild(label);
        card.appendChild(button('Retake', 'ghost', function () { send('retake', { slotNumber: slot.slotNumber }); }, !slot.filled));
        slots.appendChild(card);
      });
    }

    var buttons = el('buttons');
    buttons.textContent = '';
    if (viewData.stage === 'ready') buttons.appendChild(button('Start', 'primary', function () { send('start'); }));
    if (viewData.stage === 'consent') buttons.appendChild(button('I agree · start', 'primary', function () { send('consent'); }));
    if (viewData.stage === 'review') buttons.appendChild(button('Use these photos', 'primary', function () { send('continue'); }));
    if (viewData.stage === 'finished') {
      buttons.appendChild(button('Print another', 'ghost', function () { send('reprint'); }));
      buttons.appendChild(button('New session', 'primary', function () { send('done'); }));
    }
    if (viewData.stage === 'paused' || viewData.stage === 'busy' || viewData.stage === 'off') {
      buttons.appendChild(button('Try again', 'ghost', function () { reconnect(true); }));
    }
  }

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    socket = new WebSocket(protocol + location.host + location.pathname + 'ws');
    socket.addEventListener('open', function () {
      retryDelay = 1000;
      setConnection(true);
    });
    socket.addEventListener('message', function (event) {
      try { render(JSON.parse(event.data)); } catch (error) { /* ignore a malformed frame */ }
    });
    socket.addEventListener('close', function () {
      setConnection(false);
      if (!view || view.stage === 'off') el('headline').textContent = 'Reconnecting…';
      scheduleReconnect();
    });
    socket.addEventListener('error', function () {
      el('stream-warning').hidden = false;
      el('stream-warning').textContent = 'The booth link dropped. Photos are still kept on the booth.';
    });
  }

  function scheduleReconnect() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () { retryTimer = null; connect(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 8000);
  }

  function reconnect(immediate) {
    if (socket) { try { socket.close(); } catch (error) { /* already closed */ } }
    if (immediate) { retryTimer = null; retryDelay = 1000; connect(); }
  }

  var preview = el('preview');
  preview.addEventListener('error', function () {
    var warning = el('stream-warning');
    warning.hidden = false;
    warning.textContent = 'The camera preview is unavailable. The booth screen still works, and photos are taken on the booth.';
  });
  preview.addEventListener('load', function () {
    var warning = el('stream-warning');
    warning.hidden = true;
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && (!socket || socket.readyState > 1)) reconnect(true);
  });

  connect();
})();
`;
