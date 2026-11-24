import { openDatabase } from '../../storage/database/connection';
import { isSessionId } from '../../../shared/validation/identifiers';
import { generateSessionToken } from '../../../core/token';

export function createSessionShareLink(userDataPath: string, sessionIdValue: unknown, baseUrlValue: unknown): { url: string; expiresAt: string } {
  if (!isSessionId(sessionIdValue) || typeof baseUrlValue !== 'string') throw new Error('Invalid share-link request');
  let baseUrl: URL;
  try { baseUrl = new URL(baseUrlValue); } catch { throw new Error('Configure a valid HTTPS download URL first'); }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== '/') throw new Error('Download URL must be an HTTPS site origin');
  const database = openDatabase(userDataPath);
  try {
    const session = database.prepare(`SELECT s.status, e.expiry_days FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = ?`).get(sessionIdValue) as { status: string; expiry_days: number } | undefined;
    if (!session || session.status !== 'completed') throw new Error('Only completed sessions can be shared');
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + session.expiry_days * 24 * 60 * 60 * 1000).toISOString();
    database.prepare("UPDATE sessions SET public_token = ?, token_expires_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(token, expiresAt, sessionIdValue);
    return { url: `${baseUrl.origin}/d/${token}`, expiresAt };
  } finally { database.close(); }
}
