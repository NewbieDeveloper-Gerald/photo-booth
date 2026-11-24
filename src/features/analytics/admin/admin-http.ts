import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { attemptAdminPin, hasAdminPin } from '../../security/admin-pin';
import { readBoothStats } from '../data/stats-repository';
import { ADMIN_CSP, renderAdminDashboard, renderAdminError, renderAdminLogin } from './admin-html';
import { csvFileName, statsCsv } from '../domain/stats';

/** Two hours is long enough to read a laptop screen and short enough to forget about. */
export const DASHBOARD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_DASHBOARD_SESSIONS = 8;
const MAX_LOGIN_BODY_BYTES = 512;
const COOKIE_NAME = 'pb_dashboard';

/** Cookie -> expiry. Held in memory only: restarting the booth signs every screen out. */
export type DashboardSessions = Map<string, number>;

export type AdminContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  userDataPath: string;
  sessions: DashboardSessions;
  now?: number;
};

function htmlHeaders(): Record<string, string> {
  return { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ADMIN_CSP, 'Cache-Control': 'no-store' };
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${maxAgeSeconds}`;
}

function cookieToken(request: IncomingMessage): string | null {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE_NAME && value) return value;
  }
  return null;
}

function isSignedIn(context: AdminContext, now: number): boolean {
  const token = cookieToken(context.request);
  if (!token) return false;
  const expiresAt = context.sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= now) { context.sessions.delete(token); return false; }
  return true;
}

function readFormBody(request: IncomingMessage): Promise<URLSearchParams | null> {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_LOGIN_BODY_BYTES) { request.destroy(); resolve(null); return; }
      body += chunk.toString('utf8');
    });
    request.on('end', () => resolve(new URLSearchParams(body)));
    request.on('error', () => resolve(null));
  });
}

function redirect(response: ServerResponse, location: string, extra: Record<string, string> = {}): void {
  response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...extra }).end();
}

/**
 * The dashboard's door and its numbers (F24). The PIN check is the booth's own — scrypt hash,
 * five tries then a minute locked — so this page cannot be guessed at harder than the booth.
 */
export async function handleAdminRequest(context: AdminContext): Promise<boolean> {
  const { request, response, url, userDataPath } = context;
  const now = context.now ?? Date.now();
  // Anything stale is dropped on the way past, so the map cannot grow unnoticed.
  for (const [token, expiresAt] of context.sessions) if (expiresAt <= now) context.sessions.delete(token);

  if (url.pathname === '/admin' && request.method === 'GET') {
    if (!isSignedIn(context, now)) { response.writeHead(200, htmlHeaders()); response.end(renderAdminLogin()); return true; }
    response.writeHead(200, htmlHeaders());
    response.end(renderAdminDashboard(readBoothStats(userDataPath, new Date(now))));
    return true;
  }

  if (url.pathname === '/admin/login' && request.method === 'POST') {
    const form = await readFormBody(request);
    if (!form) { response.writeHead(413, htmlHeaders()).end(renderAdminError('The sign-in form was too large.')); return true; }
    if (!hasAdminPin(userDataPath)) {
      response.writeHead(200, htmlHeaders()).end(renderAdminLogin('Set an admin PIN on the booth first.'));
      return true;
    }
    const attempt = attemptAdminPin(userDataPath, form.get('pin'), now);
    if (!attempt.ok) {
      const message = attempt.reason === 'locked'
        ? `Too many wrong PINs. Try again in ${Math.ceil(attempt.retryInMs / 1000)} s.`
        : `Incorrect PIN. ${attempt.attemptsRemaining} ${attempt.attemptsRemaining === 1 ? 'try' : 'tries'} left.`;
      response.writeHead(401, htmlHeaders()).end(renderAdminLogin(message));
      return true;
    }
    if (context.sessions.size >= MAX_DASHBOARD_SESSIONS) {
      const oldest = [...context.sessions.entries()].sort((left, right) => left[1] - right[1])[0];
      if (oldest) context.sessions.delete(oldest[0]);
    }
    const token = randomBytes(24).toString('base64url');
    context.sessions.set(token, now + DASHBOARD_SESSION_TTL_MS);
    redirect(response, '.', { 'Set-Cookie': sessionCookie(token, Math.floor(DASHBOARD_SESSION_TTL_MS / 1000)) });
    return true;
  }

  if (url.pathname === '/admin/logout' && request.method === 'POST') {
    const token = cookieToken(request);
    if (token) context.sessions.delete(token);
    redirect(response, '.', { 'Set-Cookie': sessionCookie('', 0) });
    return true;
  }

  if (url.pathname === '/admin/numbers.csv' && (request.method === 'GET' || request.method === 'HEAD')) {
    if (!isSignedIn(context, now)) { response.writeHead(401, htmlHeaders()).end(renderAdminLogin('Sign in to download the numbers.')); return true; }
    const stats = readBoothStats(userDataPath, new Date(now));
    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName(new Date(now))}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : statsCsv(stats));
    return true;
  }

  if (url.pathname.startsWith('/admin')) {
    response.writeHead(404, htmlHeaders()).end(renderAdminError('That page is not part of the dashboard.'));
    return true;
  }
  return false;
}
