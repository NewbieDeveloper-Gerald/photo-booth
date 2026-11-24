import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SALT_BYTES = 16;
const HASH_BYTES = 64;

/** scrypt with a per-secret salt, encoded so the parameters travel with the hash. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(secret, salt, HASH_BYTES, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Constant-time check that never throws on a malformed stored value. */
export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== String(SCRYPT.N) || parts[2] !== String(SCRYPT.r) || parts[3] !== String(SCRYPT.p)) return false;
  try {
    const salt = Buffer.from(parts[4]!, 'base64url');
    const expected = Buffer.from(parts[5]!, 'base64url');
    if (salt.length !== SALT_BYTES || expected.length !== HASH_BYTES) return false;
    return timingSafeEqual(scryptSync(secret, salt, expected.length, SCRYPT), expected);
  } catch { return false; }
}
