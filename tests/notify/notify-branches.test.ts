import { describe, expect, it, vi } from 'vitest';
import {
  allowlistFrom, approvalNotice, approvalUrl, isQuietHours, localParts, noticeHasHealthDetails, notifyMode, notifyPending,
  signApprovalToken, SmsNotConfigured, timezoneForHomeState, verifyApprovalToken,
} from '../../lib/notify';
import type { NotifyCaseState, NotifyRequest } from '../../lib/notify';
import { agentMailNotifier, type SystemInboxClient } from '../../lib/notify/agentmail';

const CASE = '22222222-2222-4222-8222-222222222222';
const SECRET = 'synthetic-secret';
const state: NotifyCaseState = { optIn: true, patientEmail: 'patient@example.com', homeState: 'CA', lastSentAt: null, lastDigestOn: null };
// 2026-06-15 19:00Z = noon in Los Angeles (PDT)
const NOON_LA = new Date('2026-06-15T19:00:00.000Z');

function request(over: Partial<NotifyRequest> = {}) {
  const send = vi.fn(async () => ({ id: 'm-1' }));
  const input: NotifyRequest = {
    caseId: CASE, pendingCount: 1, state, now: NOON_LA, mode: 'dev', allowlist: ['patient@example.com'],
    appBaseUrl: 'https://wayfinder.test', linkSecret: SECRET, kind: 'immediate', mailer: { send }, ...over,
  };
  return { send, input };
}

describe('notifyMode', () => {
  it.each([
    [{ WAYFINDER_DEMO: '1' }, 'demo'],
    [{ WAYFINDER_DEMO: 'true' }, 'demo'],
    [{ WAYFINDER_DEMO: 'true', NODE_ENV: 'production' }, 'demo'],
    [{ NODE_ENV: 'production' }, 'prod'],
    [{ WAYFINDER_DEMO: '0', NODE_ENV: 'production' }, 'prod'],
    [{ NODE_ENV: 'test' }, 'dev'],
    [{}, 'dev'],
  ] as const)('%j -> %s', (env, expected) => {
    expect(notifyMode(env)).toBe(expected);
  });
});

describe('allowlistFrom', () => {
  it('treats a missing env value as an empty allowlist', () => {
    expect(allowlistFrom(undefined)).toEqual([]);
  });
  it('parses a comma-separated list, normalizing case and whitespace', () => {
    expect(allowlistFrom(' A@Example.com , b@example.com ')).toEqual(['a@example.com', 'b@example.com']);
  });
});

describe('notifyPending gates', () => {
  it('nothing_pending wins over every other gate, even for a zero or negative count', async () => {
    for (const pendingCount of [0, -3]) {
      const r = request({ pendingCount, state: { ...state, optIn: false } });
      expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'nothing_pending' });
    }
  });
  it('does not send to a patient who has not opted in', async () => {
    const r = request({ state: { ...state, optIn: false } });
    expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'not_opted_in' });
    expect(r.send).not.toHaveBeenCalled();
  });
  it.each([[null], [''], ['   ']])('no_address when patientEmail is %j', async (patientEmail) => {
    const r = request({ state: { ...state, patientEmail } });
    expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'no_address' });
  });
  it('refuses an address that is not allowlisted in dev, demo, and prod without the real-send flag', async () => {
    for (const [mode, outboundAllowReal] of [['dev', 'true'], ['demo', 'true'], ['prod', undefined], ['prod', 'false'], ['prod', 'TRUE']] as const) {
      const r = request({ mode, outboundAllowReal, allowlist: ['someone-else@example.com'] });
      expect(await notifyPending(r.input), `${mode}/${outboundAllowReal}`).toEqual({ sent: false, reason: 'not_allowlisted' });
      expect(r.send).not.toHaveBeenCalled();
    }
  });
  it('skips the allowlist only in prod with outboundAllowReal exactly "true"', async () => {
    const r = request({ mode: 'prod', outboundAllowReal: 'true', allowlist: [] });
    expect((await notifyPending(r.input)).sent).toBe(true);
  });
  it('trims the patient address before sending', async () => {
    const r = request({ state: { ...state, patientEmail: '  patient@example.com ' } });
    await notifyPending(r.input);
    expect(r.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'patient@example.com' }));
  });
});

describe('notifyPending debounce and digest', () => {
  it('debounces an immediate notice sent less than an hour ago', async () => {
    const r = request({ state: { ...state, lastSentAt: new Date(NOON_LA.getTime() - 59 * 60_000) } });
    expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'debounced' });
  });
  it('allows an immediate notice at exactly one hour (boundary is exclusive)', async () => {
    const r = request({ state: { ...state, lastSentAt: new Date(NOON_LA.getTime() - 60 * 60_000) } });
    expect((await notifyPending(r.input)).sent).toBe(true);
  });
  it('does not apply the hourly debounce to a digest', async () => {
    const r = request({ kind: 'digest', state: { ...state, lastSentAt: new Date(NOON_LA.getTime() - 1000) } });
    expect((await notifyPending(r.input)).sent).toBe(true);
  });
  it('refuses a second digest on the same local day', async () => {
    const r = request({ kind: 'digest', state: { ...state, lastDigestOn: '2026-06-15' } });
    expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'digest_already_sent' });
  });
  it('sends a digest when the last one was a previous local day, and records today', async () => {
    const r = request({ kind: 'digest', state: { ...state, lastDigestOn: '2026-06-14' } });
    expect(await notifyPending(r.input)).toMatchObject({ sent: true, lastDigestOn: '2026-06-15' });
  });
  it('keeps the previous lastDigestOn after an immediate send', async () => {
    const r = request({ state: { ...state, lastDigestOn: '2026-06-01' } });
    expect(await notifyPending(r.input)).toMatchObject({ sent: true, lastDigestOn: '2026-06-01', lastSentAt: NOON_LA.toISOString() });
  });
  it('uses the patient local date, not UTC, for the digest day', async () => {
    // 2026-06-16 02:00Z is still 2026-06-15 7pm in LA, but that is not quiet hours.
    const r = request({ kind: 'digest', now: new Date('2026-06-16T02:00:00.000Z'), state: { ...state, lastDigestOn: '2026-06-15' } });
    expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'digest_already_sent' });
  });
});

describe('notifyPending content and mailer', () => {
  it('blocks the send if the link base URL smuggles in a health term', async () => {
    const r = request({ appBaseUrl: 'https://cancer.example.test' });
    expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'health_text' });
    expect(r.send).not.toHaveBeenCalled();
  });
  it('propagates a mailer failure instead of reporting a send', async () => {
    const send = vi.fn(async () => { throw new Error('smtp down'); });
    await expect(notifyPending(request({ mailer: { send } }).input)).rejects.toThrow('smtp down');
  });
  it('refuses to build a link without a signing secret', async () => {
    await expect(notifyPending(request({ linkSecret: '' }).input)).rejects.toThrow('WAYFINDER_NOTIFY_LINK_SECRET');
  });
});

describe('quiet hours boundaries', () => {
  // June: LA is UTC-7.
  it.each([
    ['07:59 local is quiet', '2026-06-15T14:59:00Z', true],
    ['08:00 local is open', '2026-06-15T15:00:00Z', false],
    ['20:59 local is open', '2026-06-16T03:59:00Z', false],
    ['21:00 local is quiet', '2026-06-16T04:00:00Z', true],
    ['midnight local is quiet', '2026-06-16T07:00:00Z', true],
  ])('%s', (_n, iso, quiet) => {
    expect(isQuietHours(new Date(iso), 'CA')).toBe(quiet);
  });
  it('is quiet in notify before sending, so no mailer call', async () => {
    const r = request({ now: new Date('2026-06-16T04:00:00Z') });
    expect(await notifyPending(r.input)).toEqual({ sent: false, reason: 'quiet_hours' });
    expect(r.send).not.toHaveBeenCalled();
  });
  it('honors DST: the same UTC instant is a different local hour in summer and winter', () => {
    expect(localParts(new Date('2026-01-15T16:00:00Z'), 'America/New_York').hour).toBe(11);
    expect(localParts(new Date('2026-07-15T16:00:00Z'), 'America/New_York').hour).toBe(12);
  });
  it('reports local hour 0 (not 24) at midnight and the local date', () => {
    expect(localParts(new Date('2026-06-16T07:00:00Z'), 'America/Los_Angeles')).toEqual({ hour: 0, date: '2026-06-16' });
  });
  it('does not shift Arizona for DST', () => {
    expect(localParts(new Date('2026-07-15T19:00:00Z'), timezoneForHomeState('AZ')).hour).toBe(12);
  });
  it.each([[null], [undefined], [''], ['  '], ['ZZ'], ['California']])('falls back to Eastern for home state %j', (homeState) => {
    expect(timezoneForHomeState(homeState)).toBe('America/New_York');
  });
  it('normalizes lowercase and padded state codes', () => {
    expect(timezoneForHomeState(' ca ')).toBe('America/Los_Angeles');
    expect(timezoneForHomeState('hi')).toBe('Pacific/Honolulu');
  });
});

describe('approval link tokens', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const signed = () => signApprovalToken(CASE, now, SECRET);
  it('round-trips and expires exactly seven days out', () => {
    const { token, exp } = signed();
    expect(exp - now.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(verifyApprovalToken(token, SECRET, now)).toEqual({ ok: true, caseId: CASE });
    expect(verifyApprovalToken(token, SECRET, new Date(exp))).toEqual({ ok: true, caseId: CASE });
    expect(verifyApprovalToken(token, SECRET, new Date(exp + 1))).toEqual({ ok: false, reason: 'expired' });
  });
  it.each([[''], ['a.b'], ['a.b.c.d'], ['only']])('malformed token %j', (token) => {
    expect(verifyApprovalToken(token, SECRET, now)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('rejects a wrong secret, a tampered case id, and a tampered expiry', () => {
    const { token } = signed();
    const [c, e, s] = token.split('.');
    expect(verifyApprovalToken(token, 'other', now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyApprovalToken(`other-case.${e}.${s}`, SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyApprovalToken(`${c}.${Number(e) + 1}.${s}`, SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a signature of the wrong length without throwing', () => {
    const { token } = signed();
    expect(verifyApprovalToken(`${token}x`, SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyApprovalToken(`${CASE}.123.`, SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a correctly signed token whose expiry is not a number', async () => {
    const { createHmac } = await import('node:crypto');
    const payload = `${CASE}.never`;
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifyApprovalToken(`${payload}.${sig}`, SECRET, now)).toEqual({ ok: false, reason: 'expired' });
  });
  it('refuses to sign with an empty secret', () => {
    expect(() => signApprovalToken(CASE, now, '')).toThrow('WAYFINDER_NOTIFY_LINK_SECRET');
  });
  it('approvalUrl strips one trailing slash and url-encodes the token', () => {
    expect(approvalUrl('https://w.test/', CASE, 'a b/c')).toBe(`https://w.test/cases/${CASE}/outbox?approval=a%20b%2Fc`);
    expect(approvalUrl('https://w.test', CASE, 't')).toBe(`https://w.test/cases/${CASE}/outbox?approval=t`);
  });
});

describe('compose', () => {
  it('clamps negative counts to zero and floors fractions', () => {
    expect(approvalNotice(-4, 'L').text).toContain('You have 0 item(s)');
    expect(approvalNotice(2.9, 'L').text).toContain('You have 2 item(s)');
  });
  it('flags health words case-insensitively, whole words only', () => {
    expect(noticeHasHealthDetails('Your DIAGNOSIS is ready')).toBe(true);
    expect(noticeHasHealthDetails('ICD code')).toBe(true);
    expect(noticeHasHealthDetails('a medicinal herb garden')).toBe(false);
    expect(noticeHasHealthDetails(approvalNotice(3, 'https://w.test/x').text)).toBe(false);
  });
});

describe('agentMailNotifier', () => {
  it('sends from the system inbox with fixed labels and no retries, returning the message id', async () => {
    const send = vi.fn(async () => ({ messageId: 'msg-9' }));
    const client: SystemInboxClient = { inboxes: { messages: { send } } };
    const res = await agentMailNotifier(client, 'inbox-1').send({ to: 'p@example.com', subject: 'S', text: 'T' });
    expect(res).toEqual({ id: 'msg-9' });
    expect(send).toHaveBeenCalledWith('inbox-1', { to: 'p@example.com', subject: 'S', text: 'T', labels: ['wayfinder', 'patient-notify'] }, { maxRetries: 0 });
  });
  it('does not swallow provider errors', async () => {
    const client: SystemInboxClient = { inboxes: { messages: { send: async () => { throw new Error('429'); } } } };
    await expect(agentMailNotifier(client, 'i').send({ to: 'p@example.com', subject: 'S', text: 'T' })).rejects.toThrow('429');
  });
});

describe('SmsNotConfigured', () => {
  it('always rejects: no SMS provider is wired, so nothing can be sent by accident', async () => {
    await expect(new SmsNotConfigured().send()).rejects.toThrow('SMS notifications are not configured');
  });
});
