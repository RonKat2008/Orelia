import { hmac, safeEqual } from '../crypto/token-box';

/**
 * Private ICS subscription URLs: /api/calendar/feed/<id>.<sig>.ics. The signature is an HMAC over the feed id with
 * a purpose-bound subkey of WAYFINDER_TOKEN_KEY; only the id is stored. Revoking sets revoked_at, so an old URL
 * stops working even though its signature still verifies.
 */
type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSE = 'calendar-feed-v1';

export function signFeedToken(feedId: string, env: Env = process.env): string {
  if (!UUID.test(feedId)) throw new Error('Invalid feed id');
  return `${feedId}.${hmac(PURPOSE, feedId, env)}`;
}

/** The feed id when the token is well-formed and correctly signed, else null. Accepts a trailing ".ics". */
export function verifyFeedToken(token: string, env: Env = process.env): string | null {
  const clean = token.replace(/\.ics$/i, '');
  const dot = clean.indexOf('.');
  if (dot <= 0) return null;
  const id = clean.slice(0, dot);
  const sig = clean.slice(dot + 1);
  if (!UUID.test(id) || !sig || sig.length > 64) return null;
  try {
    return safeEqual(sig, hmac(PURPOSE, id, env)) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface FeedRow { id: string; ownerKey: string; revokedAt: string | null; createdAt: string }

/** A feed serves only while it exists and is not revoked. */
export function feedIsLive(row: FeedRow | undefined): row is FeedRow {
  return !!row && row.revokedAt === null;
}
