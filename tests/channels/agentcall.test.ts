import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AgentCallChannel, normalizeTurns, parseAgentCallWebhook, transcriptToText, verifyAgentCallSignature } from '../../lib/channels/agentcall';
import { ChannelError } from '../../lib/channels/types';
import { AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';
import { checkOutbound } from '../../lib/safety/outbound-gate';
import { allowlist, forged, forgedCall, gatedCall, guard, TEST_EMAIL, TEST_PHONE } from './helpers';

const KEY = 'ac_live_SECRETKEY123';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function make(res: Response = json({ id: 'call_1', status: 'initiated' })) {
  const fetcher = vi.fn(async () => res.clone());
  const ch = new AgentCallChannel({ apiKey: KEY, fromNumberId: 'num_abc', guard, fetcher: fetcher as unknown as typeof fetch, systemPrompt: 'You are Orelia.', voice: 'alloy', maxDurationSecs: 300 });
  return { fetcher, ch };
}
const caught = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection'); }, e => e as ChannelError);

describe('AgentCallChannel.send', () => {
  it('posts the expected request', async () => {
    const { ch, fetcher } = make();
    const ref = await ch.send(gatedCall());
    expect(ref).toEqual({ provider: 'agentcall', channel: 'voice', callId: 'call_1', status: 'initiated' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit & { body: string; headers: Record<string, string> }];
    expect(url).toBe('https://api.agentcall.co/v1/calls/ai');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeDefined();
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: 'num_abc', to: TEST_PHONE, voice: 'alloy', maxDurationSecs: 300 });
    expect(body.firstMessage).toBe(AI_DISCLOSURE_VOICE);
    expect(body.systemPrompt).toContain('You are Orelia.');
    expect(body.systemPrompt).toContain('how to schedule a new patient visit');
    expect(body.systemPrompt).toContain('no medical advice');
    expect(body.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('includes metadata when the draft has contact and case ids', async () => {
    const r = checkOutbound({
      draft: { channel: 'voice', address: TEST_PHONE, body: `${AI_DISCLOSURE_VOICE} Hello.`, contactId: 'c1', caseId: 'case1', approvedAt: '2026-10-28T15:00:00Z' },
      consent: { sharedFields: [] }, caseRecord: {}, contacts: [{ id: 'c1', address: TEST_PHONE, state: 'drafted' }], allowlist, now: '2026-10-28T16:00:00Z', mode: 'demo',
    } as Parameters<typeof checkOutbound>[0]);
    if (!r.ok) throw new Error(`refused: ${r.reasons}`);
    const { ch, fetcher } = make();
    await ch.send(r.payload);
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body).metadata).toEqual({ contactId: 'c1', caseId: 'case1' });
  });

  it('idempotency key is stable across retries', async () => {
    const { ch, fetcher } = make();
    await ch.send(gatedCall()); await ch.send(gatedCall());
    const keys = fetcher.mock.calls.map(c => JSON.parse((c as unknown as [string, { body: string }])[1].body).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('accepts callId in the response', async () => {
    const { ch } = make(json({ callId: 'call_9' }));
    expect((await ch.send(gatedCall())).callId).toBe('call_9');
  });

  it('refuses forged, non-allowlisted and email payloads without fetching', async () => {
    const { ch, fetcher } = make();
    for (const bad of [forged(TEST_PHONE), forged('+12025550199'), forged(TEST_EMAIL)]) await expect(ch.send(bad)).rejects.toBeInstanceOf(ChannelError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a script without the disclosure', async () => {
    const gate = checkOutbound({
      draft: { channel: 'voice', address: TEST_PHONE, body: 'Hello there.', approvedAt: '2026-10-28T15:00:00Z' },
      consent: { sharedFields: [] }, caseRecord: {}, contacts: [], allowlist, now: '2026-10-28T16:00:00Z', mode: 'demo',
    } as Parameters<typeof checkOutbound>[0]);
    expect(gate).toEqual({ ok: false, reasons: expect.arrayContaining(['missing_disclosure']) });
    const { ch, fetcher } = make();
    await expect(ch.send(forgedCall())).rejects.toBeInstanceOf(ChannelError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps HTTP errors and never leaks the api key', async () => {
    for (const [status, retryable] of [[400, false], [401, false], [404, false], [429, true], [500, true], [503, true]] as const) {
      const { ch } = make(json({ error: 'nope' }, status));
      const e = await caught(ch.send(gatedCall()));
      expect(e.status).toBe(status); expect(e.retryable).toBe(retryable);
      expect(e.body).toEqual({ error: 'nope' });
      expect(e.message).not.toContain(KEY);
    }
  });

  it('network errors are retryable and scrubbed', async () => {
    const fetcher = vi.fn(async () => { throw new Error(`boom ${KEY}`); });
    const ch = new AgentCallChannel({ apiKey: KEY, fromNumberId: 'num_abc', guard, fetcher: fetcher as unknown as typeof fetch });
    const e = await caught(ch.send(gatedCall()));
    expect(e.retryable).toBe(true); expect(e.message).not.toContain(KEY);
  });

  it('errors when the response has no call id', async () => {
    const { ch } = make(json({ status: 'initiated' }));
    await expect(ch.send(gatedCall())).rejects.toThrow(/call id/);
  });
});

describe('getCall / getTranscript', () => {
  it('uses the assumed paths', async () => {
    const turns = [{ role: 'ai', text: 'Hi' }];
    const { ch, fetcher } = make(json({ id: 'call_1', status: 'completed', transcript: turns }));
    expect(await ch.getCall('call_1')).toEqual({ callId: 'call_1', status: 'completed', transcript: turns });
    expect(await ch.getTranscript('call_1')).toMatchObject({ transcript: turns });
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe('https://api.agentcall.co/v1/calls/call_1');
    expect(calls[0]![1].method).toBe('GET');
    expect(calls[1]![0]).toBe('https://api.agentcall.co/v1/calls/call_1/transcript');
  });

  it('maps documented GET transcript entries (assistant/user) onto ai/human', async () => {
    const { ch } = make(json({ entries: [{ role: 'assistant', text: 'Hello', timestamp: 't1' }, { role: 'user', text: 'Hi' }], summary: 's' }));
    expect(await ch.getTranscript('call_1')).toEqual({ callId: 'call_1', transcript: [{ role: 'ai', text: 'Hello', timestamp: 't1' }, { role: 'human', text: 'Hi' }] });
  });
});

describe('normalizeTurns', () => {
  it('reads webhook transcript and drops unknown roles', () => {
    expect(normalizeTurns({ transcript: [{ role: 'ai', text: 'a' }, { role: 'system', text: 'x' }, { role: 'caller', text: 'b' }] })).toEqual([{ role: 'ai', text: 'a' }, { role: 'human', text: 'b' }]);
  });
});

const SECRET = 'whsec_test';
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verifyAgentCallSignature', () => {
  const body = '{"event":"call.status"}';
  it('accepts a valid signature', () => expect(verifyAgentCallSignature(body, sign(body), SECRET)).toBe(true));
  it('rejects tampered body, wrong secret, missing and malformed headers', () => {
    expect(verifyAgentCallSignature(body + ' ', sign(body), SECRET)).toBe(false);
    expect(verifyAgentCallSignature(body, sign(body, 'other'), SECRET)).toBe(false);
    expect(verifyAgentCallSignature(body, null, SECRET)).toBe(false);
    expect(verifyAgentCallSignature(body, 'abc', SECRET)).toBe(false);
    expect(verifyAgentCallSignature(body, 'sha256=abcd', SECRET)).toBe(false);
    expect(verifyAgentCallSignature(body, sign(body).replace('sha256=', 'sha1='), SECRET)).toBe(false);
  });
});

describe('parseAgentCallWebhook', () => {
  const known = (id: string) => (id === 'call_1' ? 'contact_1' : undefined);
  const hdr = (b: string) => ({ 'X-AgentCall-Signature': sign(b) });
  const transcriptEvt = JSON.stringify({ event: 'call.transcript', timestamp: '2026-10-28T17:00:00Z', data: { callId: 'call_1', transcript: [{ role: 'ai', text: 'Hello' }, { role: 'human', text: 'Hi, front desk' }] } });

  it('formats a transcript event', async () => {
    const r = await parseAgentCallWebhook(transcriptEvt, hdr(transcriptEvt), SECRET, known);
    expect(r).toMatchObject({ provider: 'agentcall', channel: 'voice', eventType: 'call.transcript', callId: 'call_1', contactId: 'contact_1', status: 'completed', receivedAt: '2026-10-28T17:00:00Z', body: 'AI: Hello\nCallee: Hi, front desk' });
  });
  it('accepts Headers and uses call.status status', async () => {
    const b = JSON.stringify({ event: 'call.status', timestamp: '2026-10-28T17:00:00Z', data: { callId: 'call_1', status: 'ringing' } });
    const r = await parseAgentCallWebhook(b, new Headers(hdr(b)), SECRET, known);
    expect(r).toMatchObject({ status: 'ringing', body: '' });
  });
  it('other events have empty body', async () => {
    const b = JSON.stringify({ event: 'call.recording', timestamp: 't', data: { callId: 'call_1' } });
    expect((await parseAgentCallWebhook(b, hdr(b), SECRET, known)).body).toBe('');
  });
  it('rejects bad signature (401), unknown call (404), malformed JSON (400)', async () => {
    expect((await caught(parseAgentCallWebhook(transcriptEvt, { 'x-agentcall-signature': 'sha256=' + '0'.repeat(64) }, SECRET, known))).status).toBe(401);
    const unk = JSON.stringify({ event: 'call.transcript', timestamp: 't', data: { callId: 'other', transcript: [] } });
    const e = await caught(parseAgentCallWebhook(unk, hdr(unk), SECRET, known));
    expect(e.status).toBe(404); expect(e.message).toMatch(/not a Orelia call/i);
    expect((await caught(parseAgentCallWebhook('{nope', hdr('{nope'), SECRET, known))).status).toBe(400);
  });
});

describe('transcriptToText', () => {
  it('labels roles', () => expect(transcriptToText([{ role: 'ai', text: 'a' }, { role: 'human', text: 'b' }])).toBe('AI: a\nCallee: b'));
});
