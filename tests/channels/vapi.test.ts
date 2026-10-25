import { describe, expect, it, vi } from 'vitest';
import { buildVapiAssistant, parseVapiMessage, reportTurns, VAPI_SECRET_HEADER, VAPI_VOICEMAIL_MESSAGE, VapiChannel, verifyVapiSecret } from '../../lib/channels/vapi';
import { ChannelError } from '../../lib/channels/types';
import { AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';
import { checkOutbound } from '../../lib/safety/outbound-gate';
import { modelFor } from '../../config/models';
import { allowlist, forged, forgedCall, gatedCall, gatedEmail, guard, TEST_PHONE } from './helpers';

const KEY = 'vapi_private_SECRETKEY123';
const SECRET = 'vapi-webhook-secret-0123456789';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Init = RequestInit & { body: string; headers: Record<string, string> };

function make(res: Response = json({ id: 'vcall_1', status: 'queued', monitor: { listenUrl: 'wss://aws.vapi.ai/listen/abc' } }), extra: Partial<ConstructorParameters<typeof VapiChannel>[0]> = {}) {
  const fetcher = vi.fn(async () => res.clone());
  const ch = new VapiChannel({
    apiKey: KEY, phoneNumberId: 'pn_1', guard, fetcher: fetcher as unknown as typeof fetch,
    serverUrl: 'https://app.example.test/api/webhooks/vapi', webhookSecret: SECRET, ...extra,
  });
  return { fetcher, ch };
}
const sent = (fetcher: ReturnType<typeof vi.fn>, i = 0) => {
  const [url, init] = fetcher.mock.calls[i] as unknown as [string, Init];
  return { url, init, body: JSON.parse(init.body) };
};
const caught = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection'); }, e => e as ChannelError);

describe('VapiChannel.send request shape', () => {
  it('POSTs /call with phoneNumberId, customer.number and an inline Claude assistant', async () => {
    const { ch, fetcher } = make();
    const ref = await ch.send(gatedCall());
    expect(ref).toEqual({ provider: 'vapi', channel: 'voice', callId: 'vcall_1', status: 'queued' });
    const { url, init, body } = sent(fetcher);
    expect(url).toBe('https://api.vapi.ai/call');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(body.phoneNumberId).toBe('pn_1');
    expect(body.customer).toEqual({ number: TEST_PHONE });
    expect(body.assistant.model).toMatchObject({ provider: 'anthropic', model: modelFor('voice'), tools: [{ type: 'endCall' }] });
    expect(body.assistant.model.model).toMatch(/^claude-/);
    expect(body.assistant.serverMessages).toEqual(['status-update', 'transcript[transcriptType="final"]', 'end-of-call-report']);
    expect(body.assistant.server).toEqual({ url: 'https://app.example.test/api/webhooks/vapi', headers: { [VAPI_SECRET_HEADER]: SECRET }, timeoutSeconds: 20 });
    expect(body.assistant.monitorPlan).toEqual({ listenEnabled: true, controlEnabled: false });
  });

  it('speaks the disclosure first, uninterruptible, and keeps it in voicemail', async () => {
    const { ch, fetcher } = make();
    await ch.send(gatedCall());
    const { assistant } = sent(fetcher).body;
    expect(assistant.firstMessage).toBe(AI_DISCLOSURE_VOICE);
    expect(assistant.firstMessageMode).toBe('assistant-speaks-first');
    expect(assistant.firstMessageInterruptionsEnabled).toBe(false);
    expect(assistant.voicemailMessage).toBe(VAPI_VOICEMAIL_MESSAGE);
    expect(assistant.voicemailMessage.startsWith(AI_DISCLOSURE_VOICE)).toBe(true);
    expect(assistant.voicemailDetection).toEqual({ provider: 'vapi' });
  });

  it('prompt holds the rules and only the gated script (no medical advice, stop, voicemail)', async () => {
    const { ch, fetcher } = make();
    await ch.send(gatedCall());
    const prompt: string = sent(fetcher).body.assistant.model.messages[0].content;
    expect(sent(fetcher).body.assistant.model.messages[0].role).toBe('system');
    expect(prompt).toContain('Give no medical advice');
    expect(prompt).toContain('Share only the details listed');
    expect(prompt).toMatch(/asks you to stop/);
    expect(prompt).toMatch(/voicemail/);
    expect(prompt).toContain('Approved script:\n' + gatedCall().body.trim());
  });

  it('includes metadata ids and omits the server block without a secret', async () => {
    const r = checkOutbound({
      draft: { channel: 'voice', address: TEST_PHONE, body: `${AI_DISCLOSURE_VOICE} Hello.`, contactId: 'c1', caseId: 'case1', approvedAt: '2026-10-28T15:00:00Z' },
      consent: { sharedFields: [] }, caseRecord: {}, contacts: [{ id: 'c1', address: TEST_PHONE, state: 'drafted' }], allowlist, now: '2026-10-28T16:00:00Z', mode: 'demo',
    } as Parameters<typeof checkOutbound>[0]);
    if (!r.ok) throw new Error(`refused: ${r.reasons}`);
    const { ch, fetcher } = make(undefined, { webhookSecret: undefined });
    await ch.send(r.payload);
    const { assistant } = sent(fetcher).body;
    expect(assistant.metadata).toEqual({ contactId: 'c1', caseId: 'case1' });
    expect(assistant.server).toBeUndefined();
  });

  it('refuses a non-Claude model before calling out', async () => {
    const { ch, fetcher } = make(undefined, { model: 'gpt-4o' });
    const err = await caught(ch.send(gatedCall()));
    expect(err.message).toMatch(/Claude/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => buildVapiAssistant(gatedCall(), { model: 'claude-sonnet-5' })).not.toThrow();
  });

  it('maps provider errors without echoing the body or secrets', async () => {
    const { ch } = make(json({ message: ['customer.number must be E.164'], echo: SECRET }, 400));
    const err = await caught(ch.send(gatedCall()));
    expect(err.status).toBe(400);
    expect(err.retryable).toBe(false);
    expect(JSON.stringify(err.body)).not.toContain(SECRET);
    expect(err.body).toEqual({ message: 'customer.number must be E.164' });
  });

  it('a response without an id is an error', async () => {
    const { ch } = make(json({ status: 'queued' }));
    expect((await caught(ch.send(gatedCall()))).message).toMatch(/call id/);
  });
});

describe('VapiChannel gate is still required', () => {
  it('refuses forged, undisclosed, email and non-allowlisted payloads without fetching', async () => {
    const { ch, fetcher } = make();
    await expect(ch.send(forged(TEST_PHONE))).rejects.toThrow(/checkOutbound/);
    await expect(ch.send(forgedCall(`${AI_DISCLOSURE_VOICE} hi`))).rejects.toThrow(/checkOutbound/);
    await expect(ch.send(gatedEmail())).rejects.toThrow(/email payload on voice/);
    const strict = new VapiChannel({ apiKey: KEY, phoneNumberId: 'pn_1', guard: { allowlist: [] }, fetcher: fetcher as unknown as typeof fetch });
    await expect(strict.send(gatedCall())).rejects.toThrow(/OUTBOUND_ALLOWLIST/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('verifyVapiSecret', () => {
  const h = (rec: Record<string, string>) => new Headers(rec);
  it('accepts the x-vapi-secret header or a Bearer token with the secret', () => {
    expect(verifyVapiSecret(h({ 'x-vapi-secret': SECRET }), SECRET)).toBe(true);
    expect(verifyVapiSecret(h({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
  });
  it('fails closed on missing config, missing header or a wrong value', () => {
    expect(verifyVapiSecret(h({ 'x-vapi-secret': SECRET }), undefined)).toBe(false);
    expect(verifyVapiSecret(h({ 'x-vapi-secret': SECRET }), '')).toBe(false);
    expect(verifyVapiSecret(h({}), SECRET)).toBe(false);
    expect(verifyVapiSecret(h({ 'x-vapi-secret': `${SECRET}x` }), SECRET)).toBe(false);
    expect(verifyVapiSecret(h({ authorization: SECRET }), SECRET)).toBe(false);
  });
});

describe('parseVapiMessage', () => {
  const call = { id: 'vcall_1', monitor: { listenUrl: 'wss://aws.vapi.ai/listen/abc', controlUrl: 'https://aws.vapi.ai/control/abc' } };
  it('status-update keeps status, end reason and the listen URL (not the control URL)', () => {
    const e = parseVapiMessage(JSON.stringify({ message: { type: 'status-update', status: 'in-progress', call } }));
    expect(e).toEqual({ kind: 'status', callId: 'vcall_1', status: 'in-progress', listenUrl: 'wss://aws.vapi.ai/listen/abc' });
    expect(JSON.stringify(e)).not.toContain('control');
  });
  it('final transcript -> one turn; partial is ignored', () => {
    const final = parseVapiMessage(JSON.stringify({ message: { type: 'transcript', transcriptType: 'final', role: 'user', transcript: 'Hello?', timestamp: 1790000000000, call } }));
    expect(final).toMatchObject({ kind: 'turn', turn: { role: 'human', text: 'Hello?', seq: 1790000000000 } });
    const partial = parseVapiMessage(JSON.stringify({ message: { type: 'transcript', transcriptType: 'partial', role: 'user', transcript: 'Hel', call } }));
    expect(partial.kind).toBe('ignored');
  });
  it('end-of-call-report maps bot/user messages and drops system prompts', () => {
    const e = parseVapiMessage(JSON.stringify({ message: {
      type: 'end-of-call-report', endedReason: 'customer-ended-call', call,
      analysis: { summary: 'They need a referral.' },
      artifact: { messages: [
        { role: 'system', message: 'SECRET PROMPT', time: 1 },
        { role: 'bot', message: AI_DISCLOSURE_VOICE, time: 2 },
        { role: 'user', message: 'We need a referral.', time: 3 },
      ] },
    } }));
    if (e.kind !== 'report') throw new Error('expected report');
    expect(e.transcript).toBe(`AI: ${AI_DISCLOSURE_VOICE}\nCallee: We need a referral.`);
    expect(e.humanSpoke).toBe(true);
    expect(e.summary).toBe('They need a referral.');
    expect(e.endedReason).toBe('customer-ended-call');
    expect(e.transcript).not.toContain('SECRET PROMPT');
  });
  it('voicemail report: no human speech', () => {
    const e = parseVapiMessage(JSON.stringify({ message: { type: 'end-of-call-report', endedReason: 'voicemail', call, artifact: { messages: [{ role: 'bot', message: VAPI_VOICEMAIL_MESSAGE, time: 1 }] } } }));
    expect(e).toMatchObject({ kind: 'report', humanSpoke: false, endedReason: 'voicemail' });
  });
  it('malformed bodies throw 400; messages without a call are ignored', () => {
    expect(() => parseVapiMessage('not json')).toThrow(ChannelError);
    expect(() => parseVapiMessage(JSON.stringify({ nope: 1 }))).toThrow(/envelope/);
    expect(parseVapiMessage(JSON.stringify({ message: { type: 'status-update' } }))).toEqual({ kind: 'ignored', type: 'status-update' });
  });
  it('report turns have stable dedupe keys', () => {
    const msgs = [{ role: 'bot', message: 'Hi', time: 5 }];
    expect(reportTurns('c', msgs)[0]!.dedupeKey).toBe(reportTurns('c', msgs)[0]!.dedupeKey);
  });
});
