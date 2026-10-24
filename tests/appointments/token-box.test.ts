import { describe, expect, it } from 'vitest';
import { hmac, open, safeEqual, seal, subkey, tokenKey, TokenKeyMissingError } from '@/lib/crypto/token-box';

const env = { WAYFINDER_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') };
const otherEnv = { WAYFINDER_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64') };

describe('seal / open', () => {
  it('round-trips a plaintext with matching AAD', () => {
    const sealed = seal('ya29.secret-token', 'google:alice', env);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('secret-token');
    expect(open(sealed, 'google:alice', env)).toBe('ya29.secret-token');
  });

  it('round-trips unicode and empty strings', () => {
    expect(open(seal('héllo 😀', 'a', env), 'a', env)).toBe('héllo 😀');
    expect(open(seal('', 'a', env), 'a', env)).toBe('');
  });

  it('fails to open with a different AAD', () => {
    const sealed = seal('t', 'google:alice', env);
    expect(() => open(sealed, 'google:bob', env)).toThrow();
  });

  it('fails when the ciphertext is tampered with', () => {
    const [v, iv, ct, tag] = seal('token-value', 'a', env).split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => open([v, iv, flipped.toString('base64url'), tag].join('.'), 'a', env)).toThrow();
  });

  it('fails when the auth tag is tampered with', () => {
    const [v, iv, ct, tag] = seal('token-value', 'a', env).split('.');
    const bad = Buffer.from(tag, 'base64url');
    bad[0] ^= 1;
    expect(() => open([v, iv, ct, bad.toString('base64url')].join('.'), 'a', env)).toThrow();
  });

  it('fails with the wrong key', () => {
    expect(() => open(seal('t', 'a', env), 'a', otherEnv)).toThrow();
  });

  it('rejects malformed sealed values', () => {
    expect(() => open('garbage', 'a', env)).toThrow('Malformed');
    expect(() => open('v2.a.b.c', 'a', env)).toThrow('Malformed');
  });

  it('uses a fresh IV each time so the same plaintext seals differently', () => {
    const a = seal('same', 'aad', env);
    const b = seal('same', 'aad', env);
    expect(a).not.toBe(b);
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
  });
});

describe('tokenKey', () => {
  it('requires exactly 32 bytes', () => {
    expect(() => tokenKey({ WAYFINDER_TOKEN_KEY: Buffer.alloc(16, 1).toString('base64') })).toThrow('32 bytes');
    expect(() => tokenKey({ WAYFINDER_TOKEN_KEY: Buffer.alloc(33, 1).toString('base64') })).toThrow('32 bytes');
  });

  it('throws TokenKeyMissingError in production without a key', () => {
    expect(() => tokenKey({ NODE_ENV: 'production' })).toThrow(TokenKeyMissingError);
  });

  it('accepts a base64url-encoded key and derives the same key as base64', () => {
    const raw = Buffer.from(Array.from({ length: 32 }, (_, i) => 250 - i)); // yields + and / in base64
    const std = raw.toString('base64');
    const url = raw.toString('base64url');
    expect(std).toMatch(/[+/]/);
    expect(tokenKey({ WAYFINDER_TOKEN_KEY: url }).equals(raw)).toBe(true);
    expect(tokenKey({ WAYFINDER_TOKEN_KEY: std }).equals(raw)).toBe(true);
  });

  it('falls back to a stable per-process dev key outside production', () => {
    expect(tokenKey({}).equals(tokenKey({}))).toBe(true);
  });
});

describe('subkey / hmac / safeEqual', () => {
  it('derives distinct subkeys per purpose', () => {
    expect(subkey('a', env).equals(subkey('b', env))).toBe(false);
    expect(subkey('a', env).equals(tokenKey(env))).toBe(false);
  });

  it('computes a deterministic, purpose-bound HMAC', () => {
    expect(hmac('p', 'v', env)).toBe(hmac('p', 'v', env));
    expect(hmac('p', 'v', env)).not.toBe(hmac('q', 'v', env));
    expect(hmac('p', 'v', env)).not.toBe(hmac('p', 'v', otherEnv));
  });

  it('compares strings in constant-time form and rejects different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
