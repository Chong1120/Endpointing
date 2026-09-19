import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Invite codes are signed with the API's own secret rather than stored: a code
 * carries the organization it joins and when it expires, so there is no table
 * to keep and nothing to leak. Rotating the secret invalidates every code.
 */
const VALID_FOR_MS = 7 * 24 * 60 * 60 * 1_000;
export const INVITE_VALID_FOR_DAYS = 7;

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(`safecall-invite:${body}`).digest('hex').slice(0, 16);

export function createInviteCode(secret: string, orgId: string, now = Date.now()): string {
  const body = `${orgId.replace(/-/g, '')}.${Math.floor((now + VALID_FOR_MS) / 1_000).toString(36)}`;
  return `${body}.${sign(secret, body)}`.toUpperCase();
}

/** Returns the organization the code joins, or null if it is malformed, altered or expired. */
export function readInviteCode(secret: string, code: unknown, now = Date.now()): string | null {
  if (typeof code !== 'string') return null;
  const [hex, expiry, signature] = code.trim().toLowerCase().split('.');
  if (!hex || !expiry || !signature || !/^[0-9a-f]{32}$/.test(hex) || !/^[0-9a-z]{1,10}$/.test(expiry)) return null;

  const expected = Buffer.from(sign(secret, `${hex}.${expiry}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Number.parseInt(expiry, 36) * 1_000 < now) return null;

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
