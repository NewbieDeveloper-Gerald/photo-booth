/**
 * Which sessions may be removed automatically. The booth only promises a retention period
 * through a guest link, so a session without an expired link is never deleted behind the
 * operator's back — those stay until the operator deletes them.
 */
export function isShareLinkExpired(tokenExpiresAt: string | null, now: number): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAt = Date.parse(tokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function shouldPurgeSession(session: { status: string; tokenExpiresAt: string | null }, now: number): boolean {
  return session.status === 'completed' && isShareLinkExpired(session.tokenExpiresAt, now);
}
