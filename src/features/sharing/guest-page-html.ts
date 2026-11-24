import { hexColorOrDefault } from '../../shared/validation/colors';

export type DownloadFile = { id: string; name: string; filePath: string; kind: 'photo' | 'layout' | 'gif' | 'boomerang' };
export type SessionDownload = {
  eventName: string; logoPath: string | null; primaryColor: string; accentColor: string;
  welcomeText: string; thankYouText: string; files: DownloadFile[];
};

/** The mobile-first guest page; branding values are validated before they reach the markup. */
export function renderGuestPage(token: string, session: SessionDownload): string {
  const safeToken = JSON.stringify(token);
  const brand = JSON.stringify({ eventName: session.eventName, welcomeText: session.welcomeText, thankYouText: session.thankYouText }).replace(/</g, '\\u003c');
  const primary = hexColorOrDefault(session.primaryColor, '#c90000');
  const accent = hexColorOrDefault(session.accentColor, '#f4f0ec');
  const logo = session.logoPath ? `<img class="event-logo" src="/api/v1/logo/${token}" alt="Event logo">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Your photobooth photos</title><style>
  *{box-sizing:border-box}body{margin:0;background:#11131c;color:#f5f2fa;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{--primary:${primary};max-width:720px;margin:auto;padding:24px 16px 48px}.card{border:1px solid #ffffff20;border-radius:16px;background:#1a1e2a;padding:18px;margin:16px 0}.head{margin:28px 0;padding-bottom:14px;border-bottom:3px solid ${accent}}.eyebrow{color:var(--primary);font-size:11px;letter-spacing:.16em;font-weight:700}.head h1{font-size:30px;margin:8px 0}.note{color:#aeb4c4;font-size:13px}.files{display:grid;gap:12px}.file{display:flex;align-items:center;justify-content:space-between;gap:14px}.loop{width:100%;border-radius:10px;display:block;border:1px solid #ffffff20}.file a,.all{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border:0;border-radius:9px;background:var(--primary);color:#181521;text-decoration:none;font-weight:700;font-size:14px}.name{font-weight:650}.error{color:#ffc1c1}.event-logo{max-width:120px;max-height:90px;object-fit:contain;margin:0 0 10px}.foot{color:#838a9d;font-size:12px;text-align:center;margin-top:24px}@media(max-width:520px){.file{align-items:flex-start;flex-direction:column}.file a{width:100%}}
  </style></head><body><main class="wrap"><header class="head"><div class="eyebrow">PHOTOBOOTH STUDIO</div>${logo}<h1 id="thanks">Your photos are ready</h1><p id="welcome" class="note">Download a photo or the finished layout. This private link works while the booth is online.</p></header><section id="content" class="card" aria-live="polite">Loading your photos…</section><p class="foot">Keep this link private. It expires automatically.</p></main><script>
  const token=${safeToken}; const brand=${brand}; document.getElementById('thanks').textContent=brand.thankYouText; document.getElementById('welcome').textContent=brand.welcomeText; const root=document.getElementById('content');
  fetch('/api/v1/session/'+encodeURIComponent(token),{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error(r.status===404?'This link is invalid or has expired.':'Could not load photos.');return r.json()}).then(data=>{
    root.textContent=''; const note=document.createElement('p');note.className='note';note.textContent=data.eventName+' · '+data.files.length+' files';root.append(note);
    if(!data.files.length){const empty=document.createElement('p');empty.textContent='No photos are available on this link.';root.append(empty);return}
    const all=document.createElement('a');all.className='all';all.href='/api/v1/all/'+encodeURIComponent(token);all.textContent='Download all';root.append(all);
    const list=document.createElement('div');list.className='files';list.style.marginTop='18px';
    for(const f of data.files){const row=document.createElement('div');row.className='file card';const label=document.createElement('span');label.className='name';label.textContent=f.name;const link=document.createElement('a');link.href='/api/v1/file/'+encodeURIComponent(token)+'/'+encodeURIComponent(f.id);link.textContent='Download';if(f.kind==='gif'||f.kind==='boomerang'){const loop=document.createElement('img');loop.className='loop';loop.alt=f.kind==='gif'?'Animated loop of your photos':'Your boomerang';loop.loading='lazy';loop.src='/api/v1/file/'+encodeURIComponent(token)+'/'+encodeURIComponent(f.id)+'?inline=1';row.append(label,loop,link)}else{row.append(label,link)}list.append(row)}root.append(list);
  }).catch(e=>{root.textContent='';const msg=document.createElement('p');msg.className='error';msg.textContent=e.message;root.append(msg)});
  </script></body></html>`;
}

export type UnavailablePage = {
  reason: 'expired' | 'invalid';
  eventName?: string;
  /** Operator-provided contact details; shown so a guest knows who to ask for copies. */
  contactText?: string;
  primaryColor?: string;
  accentColor?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

/**
 * Shown instead of the gallery when a link has expired (410) or never existed (404). It is
 * deliberately a real page rather than a bare status line: a guest who scanned a QR weeks
 * later needs to know the photos were removed on purpose and who to contact.
 */
export function renderUnavailablePage(page: UnavailablePage): string {
  const primary = hexColorOrDefault(page.primaryColor, '#c90000');
  const accent = hexColorOrDefault(page.accentColor, '#f4f0ec');
  const isExpired = page.reason === 'expired';
  const title = isExpired ? 'This link has expired' : 'This link is not valid';
  const eventName = page.eventName?.trim() ? escapeHtml(page.eventName.trim()) : 'this event';
  const message = isExpired
    ? `The photos from ${eventName} were available for the event's sharing period and have now been deleted from the booth.`
    : 'Check that you scanned the whole QR code, or ask the organiser for a fresh link.';
  const contact = page.contactText?.trim()
    ? `<p class="contact">Questions? ${escapeHtml(page.contactText.trim())}</p>`
    : '<p class="contact">Ask the organiser who gave you this link.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#11131c;color:#f5f2fa;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:560px;margin:auto;padding:32px 18px 48px}.card{border:1px solid #ffffff20;border-radius:16px;background:#1a1e2a;padding:22px;margin-top:26px}.eyebrow{color:${primary};font-size:11px;letter-spacing:.16em;font-weight:700}.head{padding-bottom:14px;border-bottom:3px solid ${accent}}h1{font-size:26px;margin:10px 0 6px}.note{color:#aeb4c4;font-size:14px;line-height:1.5}.contact{margin:18px 0 0;padding-top:14px;border-top:1px solid #ffffff1c;color:#e7e3f2;font-size:14px}.foot{color:#838a9d;font-size:12px;text-align:center;margin-top:26px}
  </style></head><body><main class="wrap"><div class="head"><div class="eyebrow">PHOTOBOOTH STUDIO</div><h1>${escapeHtml(title)}</h1></div><section class="card"><p class="note">${escapeHtml(message)}</p>${contact}</section><p class="foot">Private link · not indexed · no photos are kept after the sharing period.</p></main></body></html>`;
}

export type GalleryPage = {
  token: string;
  eventName: string;
  logoPath: string | null;
  primaryColor: string;
  accentColor: string;
  passwordProtected: boolean;
};

/**
 * The event gallery: every finished session of the event behind one link, with an optional
 * password. The page asks the booth API for a short-lived grant instead of putting the
 * password in a URL, so it never lands in a browser history or a shared screenshot.
 */
export function renderGalleryPage(gallery: GalleryPage): string {
  const safeToken = JSON.stringify(gallery.token);
  const primary = hexColorOrDefault(gallery.primaryColor, '#c90000');
  const accent = hexColorOrDefault(gallery.accentColor, '#f4f0ec');
  const logo = gallery.logoPath ? `<img class="event-logo" src="/g/${gallery.token}/logo" alt="Event logo">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Event gallery</title><style>
  *{box-sizing:border-box}body{margin:0;background:#11131c;color:#f5f2fa;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{--primary:${primary};max-width:900px;margin:auto;padding:24px 16px 48px}.head{margin:24px 0;padding-bottom:14px;border-bottom:3px solid ${accent}}.eyebrow{color:var(--primary);font-size:11px;letter-spacing:.16em;font-weight:700}.head h1{font-size:28px;margin:8px 0}.note{color:#aeb4c4;font-size:13px}.card{border:1px solid #ffffff20;border-radius:16px;background:#1a1e2a;padding:16px;margin:14px 0}.session{display:grid;gap:10px}.session h2{font-size:14px;margin:0;color:#ded9ee}.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}.thumbs a{display:block;border-radius:10px;overflow:hidden;background:#0d1017;aspect-ratio:3/4}.thumbs img{width:100%;height:100%;object-fit:cover}.error{color:#ffc1c1}.event-logo{max-width:120px;max-height:90px;object-fit:contain;margin:0 0 10px}label{display:grid;gap:6px;font-size:13px;color:#cfc9de}input{min-height:44px;padding:0 12px;border:1px solid #ffffff28;border-radius:9px;background:#10131c;color:#f5f2fa;font:inherit}button{min-height:44px;margin-top:10px;border:0;border-radius:9px;background:var(--primary);color:#181521;font:inherit;font-weight:700;cursor:pointer}.foot{color:#838a9d;font-size:12px;text-align:center;margin-top:24px}.hidden{display:none}
  </style></head><body><main class="wrap"><header class="head"><div class="eyebrow">PHOTOBOOTH STUDIO</div>${logo}<h1 id="title">Event gallery</h1><p class="note" id="note">Every session from this event. Tap a photo to save it.</p></header>
  <section class="card" id="password"${gallery.passwordProtected ? '' : ' hidden'}><form id="unlock"><label>Gallery password<input id="password-input" type="password" autocomplete="current-password" required></label><button type="submit">Open gallery</button></form><p class="note error" id="password-error" role="alert"></p></section>
  <section id="sessions" aria-live="polite"></section>
  <p class="foot" id="foot">Private link · not indexed by search engines · photos are removed when the event expires.</p></main><script>
  const token=${safeToken}; let grant='';
  const sessions=document.getElementById('sessions'); const passwordBox=document.getElementById('password');
  const params=new URLSearchParams(); function photoUrl(id){params.set('grant',grant);return '/api/v1/gallery/'+encodeURIComponent(token)+'/photo/'+encodeURIComponent(id)+'?'+params.toString()}
  async function load(){sessions.textContent='Loading the gallery…'; const headers=grant?{'x-gallery-grant':grant}:{};
    let response; try{response=await fetch('/api/v1/gallery/'+encodeURIComponent(token),{headers,cache:'no-store'})}catch{showError('Could not reach the booth. Try again in a moment.');return}
    if(response.status===401){sessions.textContent='';passwordBox.classList.remove('hidden');return}
    if(!response.ok){showError(response.status===404?'This gallery link is not valid.':'Could not load the gallery.');return}
    passwordBox.classList.add('hidden'); const data=await response.json(); document.getElementById('title').textContent=data.eventName+' gallery';
    sessions.textContent='';
    if(!data.sessions.length){showError('No photos are in this gallery yet.');return}
    for(const session of data.sessions){const card=document.createElement('section');card.className='card session';const heading=document.createElement('h2');heading.textContent=session.label;card.append(heading);
      const thumbs=document.createElement('div');thumbs.className='thumbs';
      for(const photo of session.photos){const link=document.createElement('a');link.href=photoUrl(photo.id);link.target='_blank';link.rel='noreferrer';const img=document.createElement('img');img.loading='lazy';img.src=photoUrl(photo.id);img.alt='Photo '+photo.slotNumber;link.append(img);thumbs.append(link)}
      card.append(thumbs);sessions.append(card)}}
  function showError(message){sessions.textContent='';const p=document.createElement('p');p.className='note error';p.textContent=message;sessions.append(p)}
  document.getElementById('unlock').addEventListener('submit',async event=>{event.preventDefault();const error=document.getElementById('password-error');error.textContent='';
    try{const response=await fetch('/api/v1/gallery/'+encodeURIComponent(token)+'/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password-input').value})});
      if(!response.ok){error.textContent='That password did not work.';return}
      const data=await response.json();grant=data.grant;await load()}catch{error.textContent='Could not reach the booth. Try again.'}});
  load();
  </script></body></html>`;
}
