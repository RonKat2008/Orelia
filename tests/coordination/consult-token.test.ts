import { describe, expect, it } from 'vitest';
import { hashReviewToken, mintReviewToken, REVIEW_TTL_MS, reviewSecret, sameHash, verifyReviewToken } from '@/lib/coordination/consult/token';

const env = { WAYFINDER_REVIEW_LINK_SECRET: 'review-secret' };
const now = new Date('2026-10-20T10:00:00.000Z');

describe('review tokens', () => {
  it('mints 32 random bytes + expiry + HMAC and returns only its sha256 for storage', () => {
    const a = mintReviewToken(now, env);
    const b = mintReviewToken(now, env);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(hashReviewToken(a.token));
    expect(a.tokenHash).not.toContain(a.token.split('.')[0]);
    expect(Buffer.from(a.token.split('.')[0], 'base64url')).toHaveLength(32);
    expect(new Date(a.expiresAt).getTime() - now.getTime()).toBe(REVIEW_TTL_MS);
    expect(REVIEW_TTL_MS).toBe(14 * 24 * 3600 * 1000);
  });

  it('verifies a genuine token until it expires', () => {
    const { token, tokenHash } = mintReviewToken(now, env);
    expect(verifyReviewToken(token, new Date(now.getTime() + 1000), env)?.tokenHash).toBe(tokenHash);
    expect(verifyReviewToken(token, new Date(now.getTime() + REVIEW_TTL_MS), env)).toBeNull();
  });

  it('rejects forgeries: tampered expiry, random part, signature, other secret, malformed', () => {
    const { token } = mintReviewToken(now, env);
    const [rand, exp, sig] = token.split('.');
    const later = String(Number(exp) + REVIEW_TTL_MS);
    expect(verifyReviewToken(`${rand}.${later}.${sig}`, now, env)).toBeNull();
    const otherRand = Buffer.alloc(32, 7).toString('base64url');
    expect(verifyReviewToken(`${otherRand}.${exp}.${sig}`, now, env)).toBeNull();
    expect(verifyReviewToken(`${rand}.${exp}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, now, env)).toBeNull();
    expect(verifyReviewToken(token, now, { WAYFINDER_REVIEW_LINK_SECRET: 'other' })).toBeNull();
    for (const bad of ['', 'x', `${token}.x`, token.replace(/\./g, '-'), 'a'.repeat(500)]) expect(verifyReviewToken(bad, now, env)).toBeNull();
  });

  it('uses a review-only derived secret, distinct from the raw session secret', () => {
    expect(reviewSecret({ WAYFINDER_SESSION_SECRET: 'sess' })).not.toBe('sess');
    expect(reviewSecret({ WAYFINDER_SESSION_SECRET: 'sess' })).toBe(reviewSecret({ WAYFINDER_SESSION_SECRET: 'sess' }));
    expect(() => reviewSecret({ NODE_ENV: 'production' })).toThrow();
  });

  it('compares hashes in constant time and fails closed on null', () => {
    const h = hashReviewToken('x');
    expect(sameHash(h, h)).toBe(true);
    expect(sameHash(null, h)).toBe(false);
    expect(sameHash(hashReviewToken('y'), h)).toBe(false);
  });
});
