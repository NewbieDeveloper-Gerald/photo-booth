import { openDatabase } from '../../storage/database/connection';
import { toErrorMessage } from '../../../shared/errors';
import { isSessionId } from '../../../shared/validation/identifiers';
import { createSessionShareLink } from '../data/share-link-repository';
import { maskTarget, normaliseTarget } from './addresses';
import { composeLinkMessage } from './message';
import type { LinkChannel, LinkSender, SendLinkOutcome } from './types';

/** A guest may mistype twice; after that the booth stops being an SMS machine for the public. */
export const MAX_SENDS_PER_SESSION = 3;
export const SEND_WINDOW_MS = 10 * 60 * 1000;

export type SendSessionLinkOptions = {
  userDataPath: string;
  sessionId: unknown;
  channel: unknown;
  target: unknown;
  /** The public HTTPS origin the guest links are served from; required to build a link. */
  baseUrl: string;
  sender: LinkSender;
  /** Injectable clock so the throttle can be tested without waiting. */
  now?: () => number;
};

type SessionRow = { status: string; eventName: string; contactText: string; expiryDays: number; sendLinkEnabled: number; token: string | null; tokenExpiresAt: string | null };

/**
 * The booth takes the address, builds the message and hands it to a `LinkSender` (F28). Nothing
 * about the target is written down: no database row, no log line, no setting. Only a count per
 * session is kept in memory, to stop one guest posting a hundred messages.
 */
const sendCounts = new Map<string, { count: number; windowStart: number }>();

export function clearLinkDeliveryThrottle(): void {
  sendCounts.clear();
}

export async function sendSessionLink(options: SendSessionLinkOptions): Promise<SendLinkOutcome> {
  const { userDataPath, sessionId, channel, target, baseUrl, sender, now = () => Date.now() } = options;
  if (!isSessionId(sessionId)) throw new Error('Invalid session');
  if (channel !== 'email' && channel !== 'sms') throw new Error('Choose email or SMS');

  // Validation happens before anything is looked up, so a typo never touches the database.
  const normalised = normaliseTarget(channel, target);

  const database = openDatabase(userDataPath);
  let session: SessionRow | undefined;
  try {
    session = database.prepare(`SELECT s.status, e.name AS eventName, e.contact_text AS contactText, e.expiry_days AS expiryDays,
      e.send_link_enabled AS sendLinkEnabled, s.public_token AS token, s.token_expires_at AS tokenExpiresAt
      FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = ?`).get(sessionId) as SessionRow | undefined;
  } finally { database.close(); }
  if (!session) throw new Error('Session not found');
  if (session.status !== 'completed') throw new Error('The link can be sent once the session is finished');
  if (!session.sendLinkEnabled) throw new Error('Sending the link is turned off for this event');

  const moment = now();
  const bucket = sendCounts.get(sessionId);
  if (bucket && moment - bucket.windowStart < SEND_WINDOW_MS && bucket.count >= MAX_SENDS_PER_SESSION) {
    throw new Error('Too many sends for this session. Wait a few minutes, or scan the QR code instead.');
  }

  const link = session.token && session.tokenExpiresAt && new Date(session.tokenExpiresAt).getTime() > moment
    ? `${baseUrl.replace(/\/+$/, '')}/d/${session.token}`
    : (() => {
      const created = createSessionShareLink(userDataPath, sessionId, baseUrl);
      return created.url;
    })();
  const expiresAt = session.tokenExpiresAt ?? new Date(moment + session.expiryDays * 24 * 60 * 60 * 1000).toISOString();

  // The address lives only in this call: it is handed to the sender and then forgotten.
  const result = await sender.send({
    channel: channel as LinkChannel,
    to: normalised,
    message: composeLinkMessage({ channel: channel as LinkChannel, eventName: session.eventName, link, expiresAt, contactText: session.contactText }),
    link,
    eventName: session.eventName,
  });

  sendCounts.set(sessionId, bucket && moment - bucket.windowStart < SEND_WINDOW_MS
    ? { count: bucket.count + 1, windowStart: bucket.windowStart }
    : { count: 1, windowStart: moment });

  const maskedTarget = maskTarget(channel, normalised);
  if (!result.delivered) throw new Error(result.detail || `Could not send the link to ${maskedTarget}.`);
  return { channel, maskedTarget, detail: result.detail };
}

/** Operator-facing wording for a failed send, without repeating the address. */
export function sendLinkErrorMessage(error: unknown): string {
  return toErrorMessage(error, 'Could not send the link. Check the address and try again.');
}
