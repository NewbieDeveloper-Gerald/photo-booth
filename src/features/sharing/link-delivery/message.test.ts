import { describe, expect, it } from 'vitest';
import { MAX_SMS_CHARS, composeLinkMessage, formatExpiry } from './message';

const link = 'https://photos.example.com/d/abcdefghijklmnopqrstuv';
const expiresAt = '2026-12-24T10:00:00.000Z';

describe('link message (F28)', () => {
  it('writes an email with the link, the event and the expiry', () => {
    const message = composeLinkMessage({ channel: 'email', eventName: 'Gala Night', link, expiresAt, contactText: 'ask@studio.ph' });
    expect(message).toContain('Your photos from Gala Night are ready to download:');
    expect(message).toContain(link);
    expect(message).toContain('The link works until 24 Dec 2026.');
    expect(message).toContain('Questions? ask@studio.ph');
  });

  it('keeps an SMS to one short message', () => {
    const message = composeLinkMessage({ channel: 'sms', eventName: 'Gala Night', link, expiresAt });
    expect(message).toBe('Gala Night: your photobooth photos are here https://photos.example.com/d/abcdefghijklmnopqrstuv (expires 24 Dec 2026).');
    expect(message.length).toBeLessThanOrEqual(MAX_SMS_CHARS);
    expect(message).not.toContain('\n');
  });

  it('drops the expiry wording rather than run into a second SMS part', () => {
    const long = composeLinkMessage({ channel: 'sms', eventName: 'A very long event name that goes on', link: `${link}extra`, expiresAt });
    expect(long.length).toBeLessThanOrEqual(MAX_SMS_CHARS);
    const overlong = composeLinkMessage({ channel: 'sms', eventName: 'x'.repeat(280), link, expiresAt });
    expect(overlong).toBe(`x${'x'.repeat(279)}: photos ${link}`);
  });

  it('copes with an expiry it cannot read', () => {
    expect(formatExpiry('not a date')).toBe('the date shown on screen');
    expect(formatExpiry(expiresAt)).toBe('24 Dec 2026');
  });
});
