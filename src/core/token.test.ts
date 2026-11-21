import { describe, expect, it } from 'vitest';
import { generateSessionToken } from './token';

describe('generateSessionToken', () => {
  it('returns an unpadded base64url encoding of 128 random bits', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
  });

  it('generates unique values across a batch', () => {
    const tokens = Array.from({ length: 1000 }, generateSessionToken);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
