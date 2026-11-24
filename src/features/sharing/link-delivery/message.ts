import type { LinkChannel } from './types';

/** SMS bills per part; keeping the message short keeps it to one. */
export const MAX_SMS_CHARS = 300;

export type LinkMessageInput = {
  channel: LinkChannel;
  eventName: string;
  link: string;
  expiresAt: string;
  contactText?: string;
};

/**
 * The words the guest receives. Short, one link, and an expiry date they can act on — an SMS that
 * runs to three parts costs the operator money, so the SMS version is trimmed on purpose.
 */
export function composeLinkMessage({ channel, eventName, link, expiresAt, contactText = '' }: LinkMessageInput): string {
  const date = formatExpiry(expiresAt);
  if (channel === 'sms') {
    const base = `${eventName}: your photobooth photos are here ${link} (expires ${date}).`;
    return base.length > MAX_SMS_CHARS ? `${eventName}: photos ${link}` : base;
  }
  const lines = [
    `Your photos from ${eventName} are ready to download:`,
    link,
    '',
    `The link works until ${date}.`,
  ];
  if (contactText.trim()) lines.push('', `Questions? ${contactText.trim()}`);
  return lines.join('\n');
}

/** Dates are written the way a guest reads them, not as an ISO string. */
export function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'the date shown on screen';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
