import { describe, expect, it, vi } from 'vitest';
import { buildVapiAssistant, isVapiDailyLimit, parseVapiMessage, VAPI_SECRET_HEADER, VapiChannel, VapiWebCallChannel } from '../../lib/channels/vapi';
import { ChannelError, isDefiniteNonDelivery } from '../../lib/channels/types';
import { AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';
import { forgedCall, gatedCall, gatedEmail, guard } from './helpers';

const PRIVATE = 'vapi_private_SECRETKEY123';
const PUBLIC = 'vapi_public_key_456';
const SECRET = 'vapi-webhook-secret-0123456789';
const SERVER = 'https://app.example.test/api/webhooks/vapi';
const ROOM = 'https://vapi.daily.co/AbCdEf123';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Init = RequestInit & { body: string; headers: Record<string, string> };
const bodyOf = (f: ReturnType<typeof vi.fn>) => JSON.parse((f.mock.calls[0] as unknown as [string, Init])[1].body);

function web(res: Response = json({ id: 'wcall_1', type: 'webCall', status: 'queued', webCallUrl: ROOM, assistant: { server: { headers: { [VAPI_SECRET_HEADER]: SECRET } } } })) {
  const fetcher = vi.fn(async () => res.clone());
  const ch = new VapiWebCallChannel({ publicKey: PUBLIC, guard, serverUrl: SERVER, webhookSecret: SECRET, fetcher: fetcher as unknown as typeof fetch });
  return { ch, fetcher };
}
const caught = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection'); }, e => e as ChannelError);

describe('browser call parity with the phone call', () => {
  it('web and phone send the identical assistant (same builder: rules, script, Claude model, disclosure, webhook, metadata)', async () => {
    const gated = gatedCall();
    const phoneFetch = vi.fn(async () => json({ id: 'pcall_1', status: 'queued' }));
    await new VapiChannel({ apiKey: PRIVATE, phoneNumberId: 'pn_1', guard, serverUrl: SERVER, webhookSecret: SECRET, fetcher: phoneFetch as unknown as typeof fetch }).send(gated);
    const { ch, fetcher } = web();
    await ch.send(gated);
    const phone = bodyOf(phoneFetch).assistant;
    const browser = bodyOf(fetcher).assistant;
    expect(browser).toEqual(phone);
    expect(browser).toEqual(buildVapiAssistant(gated, { serverUrl: SERVER, webhookSecret: SECRET }));
    expect(browser.firstMessage).toBe(AI_DISCLOSURE_VOICE);
    expect(browser.model).toMatchObject({ provider: 'anthropic' });
    expect(browser.model.model).toMatch(/^claude-/);
    expect(browser.server).toEqual({ url: SERVER, headers: { [VAPI_SECRET_HEADER]: SECRET }, timeoutSeconds: 20 });
  });

  it('creates the web call server-side with the PUBLIC key only and returns just the id and room URL', async () => {
    const { ch, fetcher } = web();
    const ref = await ch.send(gatedCall());
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, Init];
    expect(url).toBe('https://api.vapi.ai/call/web');
    expect(init.headers.Authorization).toBe(`Bearer ${PUBLIC}`);
    expect(JSON.stringify(init)).not.toContain(PRIVATE);
    expect(Object.keys(bodyOf(fetcher))).toEqual(['assistant']);
    expect(ref).toEqual({ provider: 'vapi', channel: 'voice', callId: 'wcall_1', webCallUrl: ROOM, status: 'queued' });
    expect(JSON.stringify(ref)).not.toContain(SECRET);
  });

  it('refuses forged payloads, emails and scripts without the disclosure before any request', async () => {
    const { ch, fetcher } = web();
    await expect(ch.send(forgedCall(`${AI_DISCLOSURE_VOICE} hi`))).rejects.toBeInstanceOf(ChannelError);
    await expect(ch.send(gatedEmail())).rejects.toBeInstanceOf(ChannelError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a room URL that is not a Vapi Daily room, and maps a 4xx to a definite non-delivery', async () => {
    const bad = await caught(web(json({ id: 'wcall_1', webCallUrl: 'https://evil.example.com/room' })).ch.send(gatedCall()));
    expect(bad).toBeInstanceOf(ChannelError);
    expect(isDefiniteNonDelivery(bad)).toBe(false);
    const rejected = await caught(web(json({ message: 'Invalid Key' }, 401)).ch.send(gatedCall()));
    expect(isDefiniteNonDelivery(rejected)).toBe(true);
  });
});

describe('phone call that never starts (Vapi daily limit)', () => {
  it('a 2xx call already ended with call.start.error-* is a definite non-delivery carrying the code', async () => {
    const fetcher = vi.fn(async () => json({ id: 'pcall_2', status: 'ended', endedReason: 'call.start.error-vapi-number-outbound-daily-limit', endedMessage: "Couldn't Start Call. Numbers Bought On Vapi Have A Daily Outbound Call Limit." }, 201));
    const ch = new VapiChannel({ apiKey: PRIVATE, phoneNumberId: 'pn_1', guard, fetcher: fetcher as unknown as typeof fetch });
    const err = await caught(ch.send(gatedCall()));
    expect(isDefiniteNonDelivery(err)).toBe(true);
    expect(err.body).toMatchObject({ code: 'call.start.error-vapi-number-outbound-daily-limit' });
    expect(isVapiDailyLimit(String((err.body as { code: string }).code))).toBe(true);
  });

  it('isVapiDailyLimit matches the code and Vapi message, nothing else', () => {
    expect(isVapiDailyLimit('vapi: HTTP 400. Couldn\'t Start Call. Numbers Bought On Vapi Have A Daily Outbound Call Limit.')).toBe(true);
    expect(isVapiDailyLimit('call.start.error-vapi-number-outbound-daily-limit')).toBe(true);
    expect(isVapiDailyLimit('vapi: HTTP 400. Invalid phone number')).toBe(false);
    expect(isVapiDailyLimit(undefined)).toBe(false);
  });
});

describe('parseVapiMessage web flag', () => {
  it('flags call.type webCall and not phone calls', () => {
    const w = parseVapiMessage(JSON.stringify({ message: { type: 'status-update', status: 'in-progress', call: { id: 'c1', type: 'webCall' } } }));
    const p = parseVapiMessage(JSON.stringify({ message: { type: 'status-update', status: 'in-progress', call: { id: 'c1', type: 'outboundPhoneCall' } } }));
    expect(w).toMatchObject({ kind: 'status', web: true });
    expect(p).not.toHaveProperty('web');
  });
});
