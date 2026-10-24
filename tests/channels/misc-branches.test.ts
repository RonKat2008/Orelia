import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCallChannel, normalizeTurns, parseAgentCallWebhook, verifyAgentCallSignature } from '@/lib/channels/agentcall';
import { fingerprintFields } from '@/lib/channels/browser-types';
import { MockBrowserProvider, MockWebChannel, TEST_APPLICATION_URL } from '@/lib/channels/mock-browser';
import { MockMailer } from '@/lib/channels/mock-mailer';
import { cleanConfirmation, cleanLabel, cleanOptions } from '@/lib/channels/page-text';
import { ChannelError } from '@/lib/channels/types';
import { checkWebUrl } from '@/lib/channels/web-url-check';
import { PageChangedError, WebFormChannel } from '@/lib/channels/web-form';
import { gatedCall, gatedEmail, guard } from './helpers';
import { FORM_URL, formFields, gatedWeb, webGuard } from './web-helpers';

afterEach(() => vi.unstubAllGlobals());

describe('page-text sanitizers', () => {
  it('treats undefined input as empty', () => {
    expect(cleanLabel(undefined)).toBe('');
    expect(cleanOptions(undefined)).toBeUndefined();
    expect(cleanConfirmation(undefined)).toBeUndefined();
  });

  it('returns undefined confirmation for blank text and trims long text to 500 chars', () => {
    expect(cleanConfirmation('')).toBeUndefined();
    expect(cleanConfirmation('x'.repeat(900))?.length).toBeLessThanOrEqual(500);
  });

  it('caps option count at 100 and option length at 120', () => {
    const opts = Array.from({ length: 150 }, () => 'o'.repeat(300));
    const cleaned = cleanOptions(opts)!;
    expect(cleaned).toHaveLength(100);
    expect(cleaned[0]!.length).toBeLessThanOrEqual(120);
  });

  it('caps labels at 200 chars', () => {
    expect(cleanLabel('l'.repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe('checkWebUrl', () => {
  const g = { allowlist: [], webAllowlist: ['forms.example.org'] };

  it('rejects unparseable and non-http(s) URLs', () => {
    expect(() => checkWebUrl('::::', 'kernel', g)).toThrow(/invalid address/);
    expect(() => checkWebUrl('javascript:alert(1)', 'kernel', g)).toThrow(/invalid address/);
    expect(() => checkWebUrl('file:///etc/passwd', 'kernel', g)).toThrow(ChannelError);
  });

  it('rejects hosts off the allowlist, including when no allowlist is configured', () => {
    expect(() => checkWebUrl('https://evil.example/', 'kernel', g)).toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    expect(() => checkWebUrl('https://forms.example.org/', 'kernel', { allowlist: [] })).toThrow(/OUTBOUND_WEB_ALLOWLIST/);
  });

  it('accepts allowlisted hosts and only skips the list for prod with "true"', () => {
    expect(() => checkWebUrl('https://forms.example.org/a', 'kernel', g)).not.toThrow();
    expect(() => checkWebUrl('https://anywhere.example/', 'kernel', { ...g, mode: 'prod', outboundAllowReal: 'true' })).not.toThrow();
    expect(() => checkWebUrl('https://anywhere.example/', 'kernel', { ...g, mode: 'dev', outboundAllowReal: 'true' })).toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    expect(() => checkWebUrl('https://anywhere.example/', 'kernel', { ...g, mode: 'prod', outboundAllowReal: 'false' })).toThrow(/OUTBOUND_WEB_ALLOWLIST/);
  });
});

describe('MockMailer', () => {
  it('threads follow-ups to the same contact and honors an explicit thread ref', async () => {
    const mailer = new MockMailer(guard, () => new Date('2026-10-28T16:00:00Z'));

    const first = await mailer.send(gatedEmail({ contactId: 'c1', caseId: 'case-1' }));
    const second = await mailer.send(gatedEmail({ contactId: 'c1' }));
    const explicit = await mailer.send(gatedEmail({ contactId: 'c1' }), { inboxId: 'inbox-z', threadId: 'thr-z', messageId: 'm' });

    expect(second.threadId).toBe(first.threadId);
    expect(explicit).toMatchObject({ inboxId: 'inbox-z', threadId: 'thr-z' });
    expect(mailer.sent[0]).toMatchObject({ caseId: 'case-1', sentAt: '2026-10-28T16:00:00.000Z' });
    expect('caseId' in mailer.sent[1]!).toBe(false);
  });

  it('gives contactless mails their own threads, omits subject when absent, and clears', async () => {
    const mailer = new MockMailer(guard);

    const a = await mailer.send(gatedEmail());
    const b = await mailer.send(gatedEmail());

    expect(a.threadId).not.toBe(b.threadId);
    expect(mailer.sent[0]).not.toHaveProperty('contactId');
    mailer.clear();
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('MockBrowserProvider sessions', () => {
  const provider = () => new MockBrowserProvider({ [FORM_URL]: { fields: formFields } });

  it('refuses reads and screenshots before a page is open', async () => {
    const s = await provider().launch();
    await expect(s.readFields()).rejects.toThrow(/No page is open/);
    await expect(s.screenshot()).rejects.toThrow(/No page is open/);
  });

  it('refuses to open unknown pages and to reopen after close, and close is idempotent', async () => {
    const p = provider();
    const s = await p.launch();

    await expect(s.open('http://localhost:3000/missing')).rejects.toThrow(/Page not found/);
    await s.close();
    await s.close();
    await expect(s.open(FORM_URL)).rejects.toThrow(/Session is closed/);
    expect(p.closedSessions).toBe(1);
  });

  it('refuses uploads to unknown or non-file fields', async () => {
    const s = await provider().launch();
    await s.open(FORM_URL);
    const file = { name: 'a.pdf', mimeType: 'application/pdf', content: new Uint8Array([1]) };

    await expect(s.upload({ ...file, fieldKey: 'ghost' })).rejects.toThrow(/Not a file field/);
    await expect(s.upload({ ...file, fieldKey: 'fullName' })).rejects.toThrow(/Not a file field/);
  });

  it('refuses to fill unknown keys without recording a preview', async () => {
    const p = provider();
    const s = await p.launch();
    await s.open(FORM_URL);

    await expect(s.fill({ ghost: 'x' })).rejects.toThrow(/Unknown field key/);
    expect(p.fillPreviews).toHaveLength(0);
  });

  it('exposes page fields and starts empty when constructed without pages', async () => {
    expect(provider().pageFields(FORM_URL)).toHaveLength(formFields.length);
    expect(provider().pageFields('nope')).toBeUndefined();
    const empty = new MockBrowserProvider();
    const s = await empty.launch();
    await expect(s.open(FORM_URL)).rejects.toBeInstanceOf(ChannelError);
  });

  it('timestamps submissions with the injected clock', async () => {
    const p = new MockBrowserProvider({ [FORM_URL]: { fields: formFields } }, () => new Date('2026-10-28T16:00:00Z'));
    const s = await p.launch();
    await s.open(FORM_URL);
    await s.submit();
    expect(p.submissions[0]!.at).toBe('2026-10-28T16:00:00.000Z');
  });
});

describe('MockWebChannel', () => {
  it('defaults to the demo pages and works without optional deps', async () => {
    const channel = new MockWebChannel({ guard: webGuard });
    const snap = await channel.readForm(TEST_APPLICATION_URL);
    expect(snap.fields.length).toBeGreaterThan(3);
  });

  it('uses custom pages, the injected clock and the upload loader', async () => {
    const loadUpload = vi.fn(async () => ({ name: 'records.pdf', mimeType: 'application/pdf', content: new Uint8Array([1]) }));
    const channel = new MockWebChannel({
      pages: { [FORM_URL]: { fields: formFields } }, guard: webGuard, loadUpload, now: () => new Date('2026-10-28T16:00:00Z'),
    });

    await channel.send(gatedWeb({ uploads: true }));

    expect(loadUpload).toHaveBeenCalledWith('doc-1');
    expect(channel.browser.submissions[0]!.at).toBe('2026-10-28T16:00:00.000Z');
  });
});

describe('WebFormChannel failure branches', () => {
  it('refuses uploads when no loader is configured, before launching a browser', async () => {
    const provider = new MockBrowserProvider({ [FORM_URL]: { fields: formFields } });
    const channel = new WebFormChannel({ provider, guard: webGuard });

    await expect(channel.send(gatedWeb({ uploads: true }))).rejects.toThrow(/No upload loader/);
    expect(provider.openSessions).toBe(0);
  });

  it('throws PageChangedError when the live form differs from the approved fingerprint and still closes', async () => {
    const provider = new MockBrowserProvider({ [FORM_URL]: { fields: formFields } });
    const channel = new WebFormChannel({ provider, guard: webGuard });
    const gated = gatedWeb({ fingerprint: fingerprintFields(formFields) });
    provider.mutatePage(FORM_URL, [...formFields, { key: 'extra', label: 'Extra', type: 'text', required: false }]);

    const err = await channel.send(gated).catch(e => e);

    expect(err).toBeInstanceOf(PageChangedError);
    expect(err.message).toContain('page_changed');
    expect(err.retryable).toBe(false);
    expect(provider.submissions).toHaveLength(0);
    expect(provider.closedSessions).toBe(1);
  });

  it('does not let a failing close mask the result', async () => {
    const provider = new MockBrowserProvider({ [FORM_URL]: { fields: formFields } });
    const realLaunch = provider.launch.bind(provider);
    provider.launch = async () => {
      const s = await realLaunch();
      s.close = async () => { throw new Error('close failed'); };
      return s;
    };
    const channel = new WebFormChannel({ provider, guard: webGuard });

    const snap = await channel.readForm(FORM_URL);

    expect(snap.fields).toHaveLength(formFields.length);
  });

  it('refuses preview URLs that are off the allowlist before launching', async () => {
    const provider = new MockBrowserProvider({ [FORM_URL]: { fields: formFields } });
    const channel = new WebFormChannel({ provider, guard: webGuard });

    await expect(channel.fillPreview('https://evil.example/x', {})).rejects.toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    expect(provider.openSessions).toBe(0);
    expect(channel.providerName).toBe('mock-browser');
    expect(channel.status).toBe('ready');
  });
});

describe('AgentCallChannel request branches', () => {
  const KEY = 'ac_test_KEYBRANCH789';
  const mk = (fetcher: unknown, over: Record<string, unknown> = {}) =>
    new AgentCallChannel({ apiKey: KEY, fromNumberId: 'num_1', guard, fetcher: fetcher as typeof fetch, ...over });
  const ok = (body: unknown) => vi.fn(async (...args: unknown[]) => (void args, new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })));

  it('uses the global fetch and default base url, and trims trailing slashes on a custom one', async () => {
    const globalFetch = ok({ id: 'call_g' });
    vi.stubGlobal('fetch', globalFetch);
    const ch = new AgentCallChannel({ apiKey: KEY, fromNumberId: 'num_1', guard });

    await ch.send(gatedCall());

    expect(String(globalFetch.mock.calls[0]![0])).toBe('https://api.agentcall.co/v1/calls/ai');
    const f = ok({ id: 'x' });
    await mk(f, { baseUrl: 'https://calls.example.org///' }).getCall('a b');
    expect(String(f.mock.calls[0]![0])).toBe('https://calls.example.org/v1/calls/a%20b');
  });

  it('omits optional voice settings and the status when not configured or returned', async () => {
    const f = ok({ callId: 'call_9' });

    const ref = await mk(f).send(gatedCall());

    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).not.toHaveProperty('voice');
    expect(body).not.toHaveProperty('maxDurationSecs');
    expect(body).not.toHaveProperty('metadata');
    expect(body.systemPrompt.startsWith('Stay strictly')).toBe(true);
    expect(ref).toEqual({ provider: 'agentcall', channel: 'voice', callId: 'call_9' });
  });

  it('fails when the response has no usable call id', async () => {
    for (const body of [{}, { id: '' }, { id: 5 }, '[1]']) {
      await expect(mk(ok(body)).send(gatedCall())).rejects.toThrow(/did not include a call id/);
    }
  });

  it('treats a non-JSON success body as an empty object', async () => {
    await expect(mk(ok('<html>oops</html>')).send(gatedCall())).rejects.toThrow(/did not include a call id/);
    const info = await mk(ok('plain text')).getCall('c1');
    expect(info).toEqual({ callId: 'c1' });
  });

  it('wraps network errors, scrubbing the key, with and without a message', async () => {
    const withMsg = mk(vi.fn(async () => { throw new Error(`connect failed using ${KEY}`); }));
    const noMsg = mk(vi.fn(async () => { throw undefined; }));
    const noKey = mk(vi.fn(async () => { throw new Error('plain'); }), { apiKey: '' });

    const a = await withMsg.getCall('c').catch(e => e);
    const b = await noMsg.getCall('c').catch(e => e);
    const c = await noKey.getCall('c').catch(e => e);

    expect(a).toMatchObject({ retryable: true, message: 'agentcall: Network error: connect failed using [redacted]' });
    expect(b.message).toBe('agentcall: Network error: request failed');
    expect(c.message).toBe('agentcall: Network error: plain');
  });

  it('marks 429/5xx retryable and other non-2xx not, keeping the parsed or raw body', async () => {
    const bad = (status: number, body: string) => mk(vi.fn(async () => new Response(body, { status })));

    expect(await bad(429, '{"error":"slow"}').getCall('c').catch(e => e)).toMatchObject({ status: 429, retryable: true, body: { error: 'slow' } });
    expect(await bad(500, 'upstream down').getCall('c').catch(e => e)).toMatchObject({ status: 500, retryable: true, body: 'upstream down' });
    expect(await bad(404, '').getCall('c').catch(e => e)).toMatchObject({ status: 404, retryable: false, body: {} });
  });

  it('reads the transcript endpoint with entries, status and id', async () => {
    const f = ok({ id: 'call_t', status: 'completed', entries: [{ role: 'assistant', text: 'Hi', timestamp: 't1' }, { role: 'user', text: 'Hello' }] });

    const info = await mk(f).getTranscript('call_t');

    expect(info).toEqual({ callId: 'call_t', status: 'completed', transcript: [{ role: 'ai', text: 'Hi', timestamp: 't1' }, { role: 'human', text: 'Hello' }] });
  });

  it('getCall falls back to the requested id when the response has none and omits a missing transcript', async () => {
    expect(await mk(ok({ status: 3 })).getCall('c7')).toEqual({ callId: 'c7' });
  });
});

describe('normalizeTurns', () => {
  it('accepts a bare array, skips junk rows, and maps caller to human', () => {
    const turns = normalizeTurns([null, 'x', { role: 'caller', text: 'hi' }, { role: 'ai', text: 5 }, { role: 'robot', text: 'x' }, { role: 'ai', text: 'ok', timestamp: 9 }]);
    expect(turns).toEqual([{ role: 'human', text: 'hi' }, { role: 'ai', text: 'ok' }]);
  });

  it('returns undefined when neither transcript nor entries is an array', () => {
    expect(normalizeTurns({ transcript: 'nope', entries: {} })).toBeUndefined();
  });
});

describe('AgentCall webhook parsing', () => {
  const SECRET = 'whsec_agentcall_test';
  const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  const parse = (payload: unknown, known: (id: string) => string | undefined = () => 'c1', headers?: Record<string, string | undefined> | Headers) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return parseAgentCallWebhook(body, headers ?? { 'X-AgentCall-Signature': sign(body) }, SECRET, known);
  };

  it('verifies only well-formed sha256 headers', () => {
    const body = '{}';
    expect(verifyAgentCallSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyAgentCallSignature(body, `  ${sign(body)}  `, SECRET)).toBe(true);
    expect(verifyAgentCallSignature(body, null, SECRET)).toBe(false);
    expect(verifyAgentCallSignature(body, sign(body), '')).toBe(false);
    expect(verifyAgentCallSignature(body, 'sha256=zz', SECRET)).toBe(false);
    expect(verifyAgentCallSignature(body, `sha256=${'0'.repeat(64)}`, SECRET)).toBe(false);
  });

  it('reads the signature from Headers instances and rejects a missing header bag entry', async () => {
    const body = JSON.stringify({ event: 'call.status', data: { callId: 'k1' } });
    const ok = await parse(body, undefined, new Headers({ 'x-agentcall-signature': sign(body) }));
    expect(ok.contactId).toBe('c1');
    await expect(parse(body, undefined, {})).rejects.toMatchObject({ status: 401 });
  });

  it('rejects malformed JSON and incomplete envelopes with 400', async () => {
    await expect(parse('{nope')).rejects.toMatchObject({ status: 400 });
    await expect(parse('null')).rejects.toMatchObject({ status: 400 });
    await expect(parse({ event: 'call.status' })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ event: 'call.status', data: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ event: 1, data: { callId: 'k' } })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ event: 'call.status', data: { callId: 7 } })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects calls Wayfinder did not place with 404', async () => {
    await expect(parse({ event: 'call.status', data: { callId: 'k' } }, () => undefined)).rejects.toMatchObject({ status: 404 });
  });

  it('builds transcript, status and unknown events, using the envelope timestamp when it is a string', async () => {
    const transcript = await parse({ event: 'call.transcript', timestamp: '2026-10-28T16:00:00Z', data: { callId: 'k', transcript: [{ role: 'ai', text: 'Hi' }, { role: 'human', text: 'Yo' }] } });
    const noTranscript = await parse({ event: 'call.transcript', data: { callId: 'k' } });
    const status = await parse({ event: 'call.status', data: { callId: 'k', status: 'ringing' } });
    const statusBare = await parse({ event: 'call.status', data: { callId: 'k', status: 5 } });
    const other = await parse({ event: 'call.other', timestamp: 5, data: { callId: 'k' } });

    expect(transcript).toMatchObject({ body: 'AI: Hi\nCallee: Yo', status: 'completed', receivedAt: '2026-10-28T16:00:00Z' });
    expect(noTranscript).toMatchObject({ body: '', status: 'completed' });
    expect(status).toMatchObject({ body: '', status: 'ringing' });
    expect(statusBare).not.toHaveProperty('status');
    expect(other).toMatchObject({ body: '', eventType: 'call.other' });
    expect(Number.isNaN(Date.parse(other.receivedAt))).toBe(false);
  });
});
