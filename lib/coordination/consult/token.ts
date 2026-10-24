import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Doctor review links. Token = `${random32}.${expMs}.${hmac}`: 32 random bytes (the capability), an expiry, and an
 * HMAC under a review-only secret (separate purpose string from sessions and patient approval links). Only
 * sha256(token) is ever stored (ConsultRequest.reviewTokenHash); the raw token exists only in the emailed link.
 */
type Env = Record<string, string | undefined>;

export const REVIEW_TOKEN_PURPOSE = 'wayfinder.consult-review.v1';
export const REVIEW_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^([A-Za-z0-9_-]{43})\.(\d{13})\.([A-Za-z0-9_-]{43})$/;
const MAX_TOKEN_LENGTH = 120;

let devSecret: string | undefined;

/** WAYFINDER_REVIEW_LINK_SECRET, else derived from WAYFINDER_SESSION_SECRET with the review purpose; dev falls back to a per-process secret. */
export function reviewSecret(env: Env = process.env): string {
  const own = env.WAYFINDER_REVIEW_LINK_SECRET?.trim();
  if (own) return createHmac('sha256', own).update(REVIEW_TOKEN_PURPOSE).digest('base64url');
  const session = env.WAYFINDER_SESSION_SECRET?.trim();
  if (session) return createHmac('sha256', session).update(REVIEW_TOKEN_PURPOSE).digest('base64url');
  if (env.NODE_ENV === 'production') throw new Error('WAYFINDER_REVIEW_LINK_SECRET or WAYFINDER_SESSION_SECRET is required to sign review links');
  devSecret ??= randomBytes(32).toString('base64url');
  return devSecret;
}

const sign = (rand: string, exp: string, key: string) => createHmac('sha256', key).update(`${REVIEW_TOKEN_PURPOSE}.${rand}.${exp}`).digest('base64url');

export function hashReviewToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface MintedReviewToken { token: string; tokenHash: string; expiresAt: string }

export function mintReviewToken(now: Date, env: Env = process.env): MintedReviewToken {
  const rand = randomBytes(32).toString('base64url');
  const exp = String(now.getTime() + REVIEW_TTL_MS);
  const token = `${rand}.${exp}.${sign(rand, exp, reviewSecret(env))}`;
  return { token, tokenHash: hashReviewToken(token), expiresAt: new Date(Number(exp)).toISOString() };
}

/** Signature + expiry check (constant-time). Returns the hash to look up, or null for anything invalid. */
export function verifyReviewToken(token: string, now: Date, env: Env = process.env): { tokenHash: string; expiresAt: string } | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const [, rand, exp, sig] = m;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(rand, exp, reviewSecret(env)));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || now.getTime() >= expMs) return null;
  return { tokenHash: hashReviewToken(token), expiresAt: new Date(expMs).toISOString() };
}

/** Constant-time equality of two hex hashes. */
export function sameHash(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Public app base (same env the patient notify links use). */
export function appBaseUrl(env: Env = process.env): string {
  return (env.WAYFINDER_APP_BASE_URL?.trim() || env.WAYFINDER_APP_ORIGIN?.trim() || 'http://localhost:3000').replace(/\/$/, '');
}

export function reviewUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, '')}/review/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------- approval MAC (security review #4)

export const APPROVAL_MAC_PURPOSE = 'wayfinder.consult-approval.v1';

export interface ApprovalFields {
  consultId: string;
  caseId: string;
  reviewTokenHash: string | null;
  doctorApprovedAt: string;
  to: string | null;
  subject: string;
  body: string;
  approvedBodyHash: string;
  approvedBy: { email: string; npi: string | null; verified: boolean };
  doctorApprovalAudit: string | null;
}

/** HMAC-SHA256 (review-link key, approval purpose) over the canonical JSON array of every approval field. */
export function approvalMac(f: ApprovalFields, env: Env = process.env): string {
  const payload = JSON.stringify([
    APPROVAL_MAC_PURPOSE, f.consultId, f.caseId, f.reviewTokenHash, f.doctorApprovedAt, f.to, f.subject, f.body,
    f.approvedBodyHash, f.approvedBy.email, f.approvedBy.npi, f.approvedBy.verified, f.doctorApprovalAudit,
  ]);
  return createHmac('sha256', reviewSecret(env)).update(payload, 'utf8').digest('base64url');
}

/** Constant-time check of a stored approval MAC. */
export function verifyApprovalMac(mac: string | null | undefined, f: ApprovalFields, env: Env = process.env): boolean {
  if (!mac) return false;
  const expected = Buffer.from(approvalMac(f, env));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
