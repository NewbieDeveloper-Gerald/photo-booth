import { describe, expect, it } from 'vitest';
import { REMOTE_APP_JS, renderRemotePage } from './remote-page-html';

describe('the tablet page (F22)', () => {
  const page = renderRemotePage({ eventName: 'Ana & Ben' });

  it('is a phone-sized page with a strict policy and no inline script', () => {
    expect(page).toContain('viewport-fit=cover');
    expect(page).toContain("default-src 'self'");
    expect(page).toContain("script-src 'self'");
    expect(page).toContain('<script src="app.js"></script>');
    expect(page).not.toMatch(/<script>[^<]/);
    expect(page).toContain('class="preview"');
  });

  it('titles the page from the event and escapes it', () => {
    expect(page).toContain('<title>Ana &amp; Ben · Photo booth</title>');
    expect(renderRemotePage({ eventName: '' })).toContain('<title>Photo booth</title>');
  });

  it('has the elements the script drives, and no operator controls', () => {
    for (const id of ['preview', 'countdown', 'headline', 'slots', 'buttons', 'conn', 'stream-warning']) {
      expect(page).toContain(`id="${id}"`);
    }
    expect(page).not.toMatch(/admin|PIN|settings/i);
  });

  it('keeps the tablet script plain, one connection, and honest when it drops', () => {
    expect(REMOTE_APP_JS).toContain("new WebSocket(protocol + location.host + location.pathname + 'ws')");
    expect(page).toContain('Reconnecting to the booth…');
    expect(REMOTE_APP_JS).toContain("el('headline').textContent = 'Reconnecting…'");
    expect(REMOTE_APP_JS).toContain('The camera preview is unavailable');
    // Every command the script can send exists in the booth's command list.
    const sent = [...REMOTE_APP_JS.matchAll(/send\('([a-z]+)'/g)].map((match) => match[1]);
    expect(new Set(sent)).toEqual(new Set(['start', 'consent', 'retake', 'continue', 'reprint', 'done']));
  });
});

describe('the guest screen fits phones and tablets (F22, USB app)', () => {
  it('lays itself out fluidly instead of by fixed pixels', () => {
    const html = renderRemotePage({ eventName: 'Ana & Ben' });
    // Safe areas, dynamic viewport height, fluid type and a two-column layout only when there is room.
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('100dvh');
    expect(html).toContain('env(safe-area-inset-top)');
    expect(html).toContain('clamp(');
    expect(html).toContain('@media (min-width: 900px)');
    expect(html).toContain('repeat(auto-fit, minmax(150px, 1fr))');
  });
});
