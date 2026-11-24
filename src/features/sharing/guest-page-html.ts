import { hexColorOrDefault } from '../../shared/validation/colors';

export type DownloadFile = { id: string; name: string; filePath: string; kind: 'photo' | 'layout' };
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
  *{box-sizing:border-box}body{margin:0;background:#11131c;color:#f5f2fa;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{--primary:${primary};max-width:720px;margin:auto;padding:24px 16px 48px}.card{border:1px solid #ffffff20;border-radius:16px;background:#1a1e2a;padding:18px;margin:16px 0}.head{margin:28px 0;padding-bottom:14px;border-bottom:3px solid ${accent}}.eyebrow{color:var(--primary);font-size:11px;letter-spacing:.16em;font-weight:700}.head h1{font-size:30px;margin:8px 0}.note{color:#aeb4c4;font-size:13px}.files{display:grid;gap:12px}.file{display:flex;align-items:center;justify-content:space-between;gap:14px}.file a,.all{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border:0;border-radius:9px;background:var(--primary);color:#181521;text-decoration:none;font-weight:700;font-size:14px}.name{font-weight:650}.error{color:#ffc1c1}.event-logo{max-width:120px;max-height:90px;object-fit:contain;margin:0 0 10px}.foot{color:#838a9d;font-size:12px;text-align:center;margin-top:24px}@media(max-width:520px){.file{align-items:flex-start;flex-direction:column}.file a{width:100%}}
  </style></head><body><main class="wrap"><header class="head"><div class="eyebrow">PHOTOBOOTH STUDIO</div>${logo}<h1 id="thanks">Your photos are ready</h1><p id="welcome" class="note">Download a photo or the finished layout. This private link works while the booth is online.</p></header><section id="content" class="card" aria-live="polite">Loading your photos…</section><p class="foot">Keep this link private. It expires automatically.</p></main><script>
  const token=${safeToken}; const brand=${brand}; document.getElementById('thanks').textContent=brand.thankYouText; document.getElementById('welcome').textContent=brand.welcomeText; const root=document.getElementById('content');
  fetch('/api/v1/session/'+encodeURIComponent(token),{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error(r.status===404?'This link is invalid or has expired.':'Could not load photos.');return r.json()}).then(data=>{
    root.textContent=''; const note=document.createElement('p');note.className='note';note.textContent=data.eventName+' · '+data.files.length+' files';root.append(note);
    if(!data.files.length){const empty=document.createElement('p');empty.textContent='No photos are available on this link.';root.append(empty);return}
    const all=document.createElement('a');all.className='all';all.href='/api/v1/all/'+encodeURIComponent(token);all.textContent='Download all';root.append(all);
    const list=document.createElement('div');list.className='files';list.style.marginTop='18px';
    for(const f of data.files){const row=document.createElement('div');row.className='file card';const label=document.createElement('span');label.className='name';label.textContent=f.name;const link=document.createElement('a');link.href='/api/v1/file/'+encodeURIComponent(token)+'/'+encodeURIComponent(f.id);link.textContent='Download';row.append(label,link);list.append(row)}root.append(list);
  }).catch(e=>{root.textContent='';const msg=document.createElement('p');msg.className='error';msg.textContent=e.message;root.append(msg)});
  </script></body></html>`;
}
