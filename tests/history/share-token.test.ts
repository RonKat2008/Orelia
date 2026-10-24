import { describe, expect, it } from 'vitest';
import { signShareToken, verifyShareToken } from '@/lib/history/share';

const env = { WAYFINDER_SHARE_SECRET: 'share-secret' };
const now = new Date('2026-10-24T10:00:00Z');
const later = new Date('2026-11-24T10:00:00Z');
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('share tokens', () => {
  it('round-trips the share id', () => {
    expect(verifyShareToken(signShareToken('abc', later, env), now, env)).toEqual({ shareId: 'abc' });
  });
  it('rejects a tampered payload or signature', () => {
    const [p, s] = signShareToken('abc', later, env).split('.');
    expect(verifyShareToken(`${b64({ sid: 'other', exp: Math.floor(later.getTime() / 1000) })}.${s}`, now, env)).toBeNull();
    expect(verifyShareToken(`${p}.${s.slice(0, -2)}xx`, now, env)).toBeNull();
  });
  it('rejects a token signed with another secret', () => {
    expect(verifyShareToken(signShareToken('abc', later, env), now, { WAYFINDER_SHARE_SECRET: 'nope' })).toBeNull();
  });
  it('rejects expired tokens', () => {
    expect(verifyShareToken(signShareToken('abc', now, env), now, env)).toBeNull();
    expect(verifyShareToken(signShareToken('abc', new Date(now.getTime() - 1000), env), now, env)).toBeNull();
  });
  it('rejects malformed input', () => {
    for (const t of ['', 'nodot', '.sig', 'a.b.c', 'x'.repeat(5000)]) expect(verifyShareToken(t, now, env)).toBeNull();
  });
  it('rejects a correctly signed but malformed payload', async () => {
    const { createHmac } = await import('node:crypto');
    const bad = Buffer.from('not json').toString('base64url');
    const key = 'share-secret';
    expect(verifyShareToken(`${bad}.${createHmac('sha256', key).update(bad).digest('base64url')}`, now, env)).toBeNull();
  });
  it('derives from the session secret when no share secret is set', () => {
    const e = { WAYFINDER_SESSION_SECRET: 'sess' };
    const t = signShareToken('abc', later, e);
    expect(verifyShareToken(t, now, e)).toEqual({ shareId: 'abc' });
    expect(verifyShareToken(t, now, { WAYFINDER_SHARE_SECRET: 'sess' })).toBeNull();
  });
  it('uses a per-process secret outside production', () => {
    const t = signShareToken('abc', later, {});
    expect(verifyShareToken(t, now, {})).toEqual({ shareId: 'abc' });
  });
  it('throws in production when no secret is configured', () => {
    expect(() => signShareToken('abc', later, { NODE_ENV: 'production' })).toThrow(/required in production/);
    expect(() => verifyShareToken('a.b', now, { NODE_ENV: 'production' })).toThrow();
  });
});
