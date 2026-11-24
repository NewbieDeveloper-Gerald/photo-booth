import { ZipFile } from 'yazl';
import Database from 'better-sqlite3';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

type DownloadFile = { id: string; name: string; filePath: string; kind: 'photo' | 'layout' };
type SessionDownload = { eventName: string; logoPath: string | null; primaryColor: string; accentColor: string; welcomeText: string; thankYouText: string; files: DownloadFile[] };
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 180;

function noIndex(response: ServerResponse): void {
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

function isLimited(request: IncomingMessage, buckets: Map<string, { started: number; count: number }>): boolean {
  const key = request.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  if (buckets.size > 2048) {
    for (const [address, value] of buckets) if (now - value.started >= RATE_WINDOW_MS) buckets.delete(address);
    if (buckets.size > 4096 && !buckets.has(key)) return true;
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.started >= RATE_WINDOW_MS) { buckets.set(key, { started: now, count: 1 }); return false; }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

function safePhotosPath(photosRoot: string, filePath: string): string | null {
  const root = path.resolve(photosRoot);
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function findSession(databasePath: string, photosRoot: string, token: string): SessionDownload | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const session = database.prepare(`SELECT s.id, e.name AS eventName, e.logo_path AS logoPath, e.primary_color AS primaryColor, e.accent_color AS accentColor, e.welcome_text AS welcomeText, e.thank_you_text AS thankYouText FROM sessions s JOIN events e ON e.id = s.event_id
      WHERE s.public_token = ? AND s.status = 'completed' AND s.token_expires_at IS NOT NULL
        AND julianday(s.token_expires_at) > julianday('now')`).get(token) as { id: string; eventName: string; logoPath: string | null; primaryColor: string; accentColor: string; welcomeText: string; thankYouText: string } | undefined;
    if (!session) return null;
    const photos = database.prepare(`SELECT p.id, p.original_path AS originalPath, p.download_path AS downloadPath, sl.slot_number AS slotNumber
      FROM sessions s JOIN slots sl ON sl.session_id = s.id JOIN photos p ON p.id = sl.current_photo_id
      WHERE s.id = ? ORDER BY sl.slot_number`).all(session.id) as Array<{ id: string; originalPath: string; downloadPath: string | null; slotNumber: number }>;
    const output = database.prepare(`SELECT id, output_path AS filePath FROM outputs WHERE session_id = ? AND kind LIKE 'finished-%'
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(session.id) as { id: string; filePath: string } | undefined;
    const files: DownloadFile[] = [];
    for (const photo of photos) {
      // Guests get the 2048px/q80 copy; sessions captured before download copies existed fall back to the original.
      const filePath = [photo.downloadPath, photo.originalPath]
        .map((candidate) => (candidate ? safePhotosPath(photosRoot, candidate) : null))
        .find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
      if (filePath) files.push({ id: photo.id, name: `Photo ${String(photo.slotNumber).padStart(2, '0')}.jpg`, filePath, kind: 'photo' });
    }
    if (output) {
      const filePath = safePhotosPath(photosRoot, output.filePath);
      if (filePath && fs.existsSync(filePath)) files.push({ id: output.id, name: 'Finished layout.jpg', filePath, kind: 'layout' });
    }
    return { eventName: session.eventName, logoPath: session.logoPath, primaryColor: session.primaryColor, accentColor: session.accentColor, welcomeText: session.welcomeText, thankYouText: session.thankYouText, files };
  } finally { database.close(); }
}

function htmlPage(token: string, session: SessionDownload): string {
  const safeToken = JSON.stringify(token);
  const brand = JSON.stringify({ eventName: session.eventName, welcomeText: session.welcomeText, thankYouText: session.thankYouText }).replace(/</g, '\\u003c');
  const primary = /^#[0-9a-f]{6}$/i.test(session.primaryColor) ? session.primaryColor : '#c90000';
  const accent = /^#[0-9a-f]{6}$/i.test(session.accentColor) ? session.accentColor : '#f4f0ec';
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

export function createDownloadServer(userDataPath: string, photosRoot: string, port = 47625, host = '127.0.0.1'): Promise<http.Server> {
  const databasePath = path.join(userDataPath, 'photobooth.sqlite');
  const buckets = new Map<string, { started: number; count: number }>();
  const server = http.createServer((request, response) => {
    noIndex(response);
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (isLimited(request, buckets)) { response.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Please wait before trying again.'); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const page = /^\/d\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (page) { const session = findSession(databasePath, photosRoot, page[1]!); if (!session) { response.writeHead(404).end('This link is invalid or has expired.'); return; } response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); response.end(request.method === 'HEAD' ? undefined : htmlPage(page[1]!, session)); return; }
    const logoRoute = /^\/api\/v1\/logo\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (logoRoute) {
      const session = findSession(databasePath, photosRoot, logoRoute[1]!);
      const logoPath = session?.logoPath;
      const allowedRoot = path.resolve(path.dirname(databasePath), 'event-assets');
      const resolved = logoPath ? path.resolve(logoPath) : '';
      if (!resolved || !resolved.startsWith(`${allowedRoot}${path.sep}`) || !fs.existsSync(resolved)) { response.writeHead(404).end(); return; }
      const type = path.extname(resolved).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': fs.statSync(resolved).size, 'Content-Disposition': 'inline' });
      if (request.method === 'HEAD') { response.end(); return; }
      fs.createReadStream(resolved).pipe(response); return;
    }
    const listing = /^\/api\/v1\/session\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (listing) {
      const session = findSession(databasePath, photosRoot, listing[1]!);
      if (!session) { response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}'); return; }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ eventName: session.eventName, files: session.files.map(({ id, name }) => ({ id, name })) }));
      return;
    }
    const all = /^\/api\/v1\/all\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (all) {
      const session = findSession(databasePath, photosRoot, all[1]!);
      if (!session) { response.writeHead(404).end(); return; }
      const zip = new ZipFile();
      zip.on('error', () => response.destroy());
      response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="photobooth-photos.zip"' });
      zip.outputStream.pipe(response);
      for (const file of session.files) zip.addFile(file.filePath, file.name, { compress: false });
      zip.end();
      return;
    }
    const fileRoute = /^\/api\/v1\/file\/([A-Za-z0-9_-]{22})\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (fileRoute) {
      const session = findSession(databasePath, photosRoot, fileRoute[1]!);
      const file = session?.files.find((candidate) => candidate.id === fileRoute[2]);
      if (!file) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="${file.name}"`, 'Content-Length': fs.statSync(file.filePath).size });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(file.filePath);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(server); });
  });
}
