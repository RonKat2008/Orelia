import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signApprovalToken(caseId: string, now: Date, secret: string): { token: string; exp: number } {
  if (!secret) throw new Error('WAYFINDER_NOTIFY_LINK_SECRET is required to sign an approval link');
  const exp = now.getTime() + TTL_MS;
  const payload = `${caseId}.${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, exp };
}

export function approvalUrl(appBaseUrl: string, caseId: string, token: string): string {
  const base = appBaseUrl.replace(/\/$/, '');
  return `${base}/cases/${caseId}/outbox?approval=${encodeURIComponent(token)}`;
}

export function verifyApprovalToken(token: string, secret: string, now: Date): { ok: true; caseId: string } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [caseId, expRaw, sig] = parts;
  const payload = `${caseId}.${expRaw}`;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || now.getTime() > exp) return { ok: false, reason: 'expired' };
  return { ok: true, caseId };
}
