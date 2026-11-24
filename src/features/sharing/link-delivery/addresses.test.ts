import { describe, expect, it } from 'vitest';
import { isLinkChannel, maskTarget, normaliseEmail, normalisePhone, normaliseTarget } from './addresses';

describe('link delivery addresses (F28)', () => {
  it('accepts ordinary email addresses and rejects things that are not one', () => {
    expect(normaliseEmail('  guest@example.com ')).toBe('guest@example.com');
    expect(normaliseEmail('a.b+tag@photo.example.ph')).toBe('a.b+tag@photo.example.ph');
    expect(() => normaliseEmail('')).toThrow('Type the email address');
    expect(() => normaliseEmail('guest.example.com')).toThrow('does not look like an email address');
    expect(() => normaliseEmail('guest@example')).toThrow('does not look like an email address');
    expect(() => normaliseEmail(`${'a'.repeat(250)}@example.com`)).toThrow('too long');
  });

  it('takes a phone number the way a guest types it, and keeps only digits', () => {
    expect(normalisePhone('+63 917 123 4567')).toBe('+639171234567');
    expect(normalisePhone('(02) 8123-4567')).toBe('0281234567');
    expect(normalisePhone('09171234567')).toBe('09171234567');
    expect(() => normalisePhone('12345')).toThrow('8 to 15 digits');
    expect(() => normalisePhone('+63 917 123 4567 8901')).toThrow('8 to 15 digits');
    expect(() => normalisePhone('call me')).toThrow('digits only');
  });

  it('routes the typed value through the chosen channel', () => {
    expect(normaliseTarget('email', 'guest@example.com')).toBe('guest@example.com');
    expect(normaliseTarget('sms', '09171234567')).toBe('09171234567');
    expect(() => normaliseTarget('sms', 'guest@example.com')).toThrow('digits only');
    expect(() => normaliseTarget('email', undefined)).toThrow('Type the email address');
    expect(isLinkChannel('email')).toBe(true);
    expect(isLinkChannel('whatsapp')).toBe(false);
  });

  it('masks what it shows back, so a bystander cannot read the address', () => {
    expect(maskTarget('email', 'guest@example.com')).toBe('g••••@example.com');
    expect(maskTarget('email', 'a@b.co')).toBe('a••@b.co');
    const international = maskTarget('sms', '+639171234567');
    expect(international.startsWith('+63 ')).toBe(true);
    expect(international.endsWith(' 4567')).toBe(true);
    expect(international).not.toContain('91712');
    const local = maskTarget('sms', '09171234567');
    expect(local.endsWith(' 4567')).toBe(true);
    expect(local).not.toContain('0917');
    // Even a very short number keeps at least three hidden digits.
    expect(maskTarget('sms', '12345678')).toBe('•••• 5678');
  });
});
