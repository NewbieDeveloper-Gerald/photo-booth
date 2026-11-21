import { randomBytes } from 'node:crypto';

/** Generate an unguessable 128-bit token as unpadded base64url (22 chars). */
export function generateSessionToken(): string {
  return randomBytes(16).toString('base64url');
}
