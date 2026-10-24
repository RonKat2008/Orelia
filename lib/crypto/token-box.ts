import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secrets at rest (OAuth tokens) are sealed with AES-256-GCM under WAYFINDER_TOKEN_KEY (32 random bytes, base64 or
 * base64url). Sealed form: `v1.<iv>.<ciphertext>.<tag>` (base64url). Additional authenticated data binds a sealed
 * value to its row (e.g. the owner key), so a ciphertext copied to another row does not open.
 */
type Env = Record<string, string | undefined>;

export class TokenKeyMissingError extends Error {
  constructor() { super('WAYFINDER_TOKEN_KEY is not configured'); this.name = 'TokenKeyMissingError'; }
}

let devKey: Buffer | undefined;

export function tokenKey(env: Env = process.env): Buffer {
  const raw = env.WAYFINDER_TOKEN_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (key.length !== 32) throw new Error('WAYFINDER_TOKEN_KEY must decode to 32 bytes');
    return key;
  }
  if (env.NODE_ENV === 'production') throw new TokenKeyMissingError();
  devKey ??= randomBytes(32);
  return devKey;
}

export function hasTokenKey(env: Env = process.env): boolean {
  return !!env.WAYFINDER_TOKEN_KEY?.trim() || env.NODE_ENV !== 'production';
}

/** Purpose-separated subkey (HKDF-SHA256) so the sealing key is never used directly for signing. */
export function subkey(purpose: string, env: Env = process.env): Buffer {
  return Buffer.from(hkdfSync('sha256', tokenKey(env), Buffer.alloc(0), `wayfinder:${purpose}`, 32));
}

const b64 = (b: Buffer) => b.toString('base64url');

export function seal(plaintext: string, aad: string, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subkey('seal-v1', env), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', b64(iv), b64(ct), b64(cipher.getAuthTag())].join('.');
}

/** Opens a sealed value; throws on tampering, a wrong key or a different AAD. */
export function open(sealed: string, aad: string, env: Env = process.env): string {
  const [version, iv, ct, tag] = sealed.split('.');
  if (version !== 'v1' || !iv || ct === undefined || !tag) throw new Error('Malformed sealed value');
  const decipher = createDecipheriv('aes-256-gcm', subkey('seal-v1', env), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function hmac(purpose: string, value: string, env: Env = process.env): string {
  return createHmac('sha256', subkey(purpose, env)).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
