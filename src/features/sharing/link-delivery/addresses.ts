import { LINK_CHANNEL_LABELS, type LinkChannel } from './types';

export const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_DIGITS = 15;
const MIN_PHONE_DIGITS = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** A guest typing on a tablet gets spaces, dashes and brackets; all of that is just formatting. */
export function normalisePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(digits)) throw new Error('Enter a phone number using digits only, e.g. +63 917 123 4567');
  const digitCount = digits.replace(/\D/g, '').length;
  if (digitCount < MIN_PHONE_DIGITS || digitCount > MAX_PHONE_DIGITS) {
    throw new Error(`A phone number needs ${MIN_PHONE_DIGITS} to ${MAX_PHONE_DIGITS} digits, including the country or area code`);
  }
  return digits;
}

export function normaliseEmail(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Type the email address to send the link to');
  if (trimmed.length > MAX_EMAIL_LENGTH) throw new Error('That email address is too long');
  if (!EMAIL_PATTERN.test(trimmed)) throw new Error('That does not look like an email address');
  return trimmed;
}

/** Validates the typed value for the chosen channel and returns it ready to send. */
export function normaliseTarget(channel: LinkChannel, value: unknown): string {
  if (typeof value !== 'string') throw new Error(`Type the ${LINK_CHANNEL_LABELS[channel] === 'SMS' ? 'phone number' : 'email address'}`);
  return channel === 'email' ? normaliseEmail(value) : normalisePhone(value);
}

export function isLinkChannel(value: unknown): value is LinkChannel {
  return value === 'email' || value === 'sms';
}

/**
 * What the panel is allowed to show afterwards. The booth never displays or stores the whole
 * address again — a guest beside them should not learn where the photos went.
 */
export function maskTarget(channel: LinkChannel, value: string): string {
  if (channel === 'email') {
    const [local = '', domain = ''] = value.split('@');
    const head = local.slice(0, 1);
    return `${head}${'•'.repeat(Math.max(2, local.length - 1))}@${domain}`;
  }
  const digits = value.replace(/\D/g, '');
  const tail = digits.slice(-4);
  // Keep the country code so the guest recognises their own number, hide everything else.
  const country = value.startsWith('+') ? `+${digits.slice(0, 2)} ` : '';
  const hidden = Math.max(3, digits.length - 4 - (country ? 2 : 0));
  return `${country}${'•'.repeat(hidden)} ${tail}`;
}
