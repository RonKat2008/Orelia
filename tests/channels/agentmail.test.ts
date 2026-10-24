import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AgentMailChannel, parseAgentMailWebhook, verifyAgentMailSignature } from '../../lib/channels/agentmail';
import { ChannelError } from '../../lib/channels/types';
import { forged, gatedCall, gatedEmail, guard, TEST_EMAIL } from './helpers';

const API_KEY = 'am_test_SECRETKEY123';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const inboxBody = { pod_id: 'pod_1', inbox_id: 'case1@agentmail.to', email: 'case1@agentmail.to', client_id: 'wayfinder-case-case-1', updated_at: '2026-10-28T16:00:00Z', created_at: '2026-10-28T16:00:00Z' };
const sendBody = { message_id: 'msg_1', thread_id: 'thr_1' };

function setup(...responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const r of responses) fetcher.mockResolvedValueOnce(r);
  const channel = new AgentMailChannel({ apiKey: API_KEY, fetcher, guard });
  return { fetcher, channel };
}
const call = (f: ReturnType<typeof vi.fn<typeof fetch>>, i: number) => {
  const [input, init] = f.mock.calls[i] as [RequestInfo | URL, RequestInit];
  return {
    url: String(input instanceof Request ? input.url : input), method: init.method, headers: new Headers(init.headers),
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  };
};
const gated = (contactId = 'c1', caseId = 'case-1') => gatedEmail({ contactId, caseId });

describe('AgentMailChannel', () => {
  it('creates an idempotent per-case inbox', async () => {
    const { fetcher, channel } = setup(json(inboxBody));
    const inbox = await channel.createCaseInbox('case-1');
    expect(inbox).toEqual({ inboxId: 'case1@agentmail.to', email: 'case1@agentmail.to' });
    const c = call(fetcher, 0);
    expect(c.url).toBe('https://api.agentmail.to/v0/inboxes');
    expect(c.method).toBe('POST');
    expect(c.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(c.body.client_id).toBe('wayfinder-case-case-1');
    await channel.createCaseInbox('case-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sends text-only mail to the allowlisted address and returns provider ids', async () => {
    const { fetcher, channel } = setup(json(inboxBody), json(sendBody));
    const g = gated();
    const ref = await channel.send(g);
    expect(ref).toEqual({ provider: 'agentmail', channel: 'email', inboxId: 'case1@agentmail.to', threadId: 'thr_1', messageId: 'msg_1', status: 'sent' });
    const c = call(fetcher, 1);
    expect(c.url).toBe('https://api.agentmail.to/v0/inboxes/case1%40agentmail.to/messages/send');
    expect(c.method).toBe('POST');
    expect(c.body.to).toBe(TEST_EMAIL);
    expect(c.body.subject).toBe(g.subject);
    expect(c.body.text).toBe(g.body);
    expect(c.body.labels).toEqual(['wayfinder', 'case:case-1', 'contact:c1']);
    expect(c.body).not.toHaveProperty('html');
    expect(c.body).not.toHaveProperty('attachments');
  });

  it('replies in an existing thread', async () => {
    const { fetcher, channel } = setup(json({ message_id: 'msg_2', thread_id: 'thr_1' }));
    const ref = await channel.sendInThread(gated(), { inboxId: 'case1@agentmail.to', messageId: 'msg_1' });
    expect(ref).toMatchObject({ threadId: 'thr_1', messageId: 'msg_2', inboxId: 'case1@agentmail.to' });
    const c = call(fetcher, 0);
    expect(c.url).toBe('https://api.agentmail.to/v0/inboxes/case1%40agentmail.to/messages/msg_1/reply');
    expect(c.body.text).toBeTruthy();
    expect(c.body.to).toEqual([TEST_EMAIL]);
    expect(c.body).not.toHaveProperty('html');
  });

  it('refuses forged, non-allowlisted, voice and caseless payloads before any network call', async () => {
    const { fetcher, channel } = setup();
    await expect(channel.send(forged())).rejects.toBeInstanceOf(ChannelError);
    await expect(channel.send(gatedCall())).rejects.toBeInstanceOf(ChannelError);
    await expect(channel.sendInThread(forged(), { inboxId: 'i', messageId: 'm' })).rejects.toBeInstanceOf(ChannelError);
    const other = new AgentMailChannel({ apiKey: API_KEY, fetcher, guard: { allowlist: ['someone-else@example.com'] } });
    await expect(other.send(gated())).rejects.toThrow(/OUTBOUND_ALLOWLIST/);
    await expect(channel.send(gatedEmail())).rejects.toThrow(/caseId/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps 4xx to non-retryable errors with the provider code', async () => {
    const { channel } = setup(json(inboxBody), json({ name: 'ValidationError', code: 'invalid_to', message: 'bad recipient' }, 400));
    const err = await channel.send(gated()).catch(e => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ provider: 'agentmail', status: 400, retryable: false, body: { code: 'invalid_to' } });
  });

  it('marks 429 and 5xx retryable without retrying inside the SDK', async () => {
    const a = setup(json(inboxBody), json({ name: 'RateLimited', message: 'slow down' }, 429, { 'retry-after': '1' }));
    expect(await a.channel.send(gated()).catch(e => e)).toMatchObject({ status: 429, retryable: true });
    expect(a.fetcher).toHaveBeenCalledTimes(2);
    const b = setup(json(inboxBody), json({ name: 'ServerError', message: 'boom' }, 503));
    expect(await b.channel.send(gated()).catch(e => e)).toMatchObject({ status: 503, retryable: true });
    expect(b.fetcher).toHaveBeenCalledTimes(2);
  });

  it('never leaks the api key in errors', async () => {
    const { channel } = setup(json(inboxBody), json({ name: 'Err', message: `bad key ${API_KEY}` }, 401));
    const err = await channel.send(gated()).catch(e => e);
    expect(err.status).toBe(401);
    expect(JSON.stringify([err.message, err.body])).not.toContain(API_KEY);
  });

  it('lists thread messages only for known threads', async () => {
    const threadBody = {
      inbox_id: 'case1@agentmail.to', thread_id: 'thr_1', labels: [], timestamp: '2026-10-28T16:00:00Z', senders: [], recipients: [],
      last_message_id: 'msg_2', message_count: 1, size: 10, updated_at: '2026-10-28T16:00:00Z', created_at: '2026-10-28T16:00:00Z', count: 1,
      messages: [{ inbox_id: 'case1@agentmail.to', thread_id: 'thr_1', message_id: 'msg_2', labels: [], timestamp: '2026-10-28T16:05:00Z', from: TEST_EMAIL, to: ['case1@agentmail.to'], subject: 'Re: hi', text: 'Sure', size: 4, updated_at: '2026-10-28T16:05:00Z', created_at: '2026-10-28T16:05:00Z' }],
    };
    const { fetcher, channel } = setup(json(threadBody));
    await expect(channel.listThreadMessages('thr_x', () => undefined)).rejects.toMatchObject({ status: 404 });
    expect(fetcher).not.toHaveBeenCalled();
    const msgs = await channel.listThreadMessages('thr_1', id => (id === 'thr_1' ? 'c1' : undefined));
    expect(msgs).toEqual([{ messageId: 'msg_2', from: TEST_EMAIL, to: ['case1@agentmail.to'], subject: 'Re: hi', text: 'Sure', timestamp: '2026-10-28T16:05:00.000Z' }]);
    expect(call(fetcher, 0).url).toBe('https://api.agentmail.to/v0/threads/thr_1');
  });
});

const SECRET = 'whsec_' + Buffer.from('test-secret').toString('base64');
const NOW = 1_800_000_000;
function sign(body: string, id = 'msg_abc', ts = NOW, secret = SECRET) {
  const key = Buffer.from(secret.replace('whsec_', ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` };
}

describe('verifyAgentMailSignature', () => {
  const body = '{"a":1}';
  it('accepts a valid signature', () => expect(verifyAgentMailSignature(body, sign(body), SECRET, NOW)).toBe(true));
  it('accepts Headers instances and any header case', () => {
    expect(verifyAgentMailSignature(body, new Headers(sign(body)), SECRET, NOW)).toBe(true);
    const upper = Object.fromEntries(Object.entries(sign(body)).map(([k, v]) => [k.toUpperCase(), v]));
    expect(verifyAgentMailSignature(body, upper, SECRET, NOW)).toBe(true);
  });
  it('rejects tampered body', () => expect(verifyAgentMailSignature('{"a":2}', sign(body), SECRET, NOW)).toBe(false));
  it('rejects wrong secret', () => expect(verifyAgentMailSignature(body, sign(body), 'whsec_' + Buffer.from('other').toString('base64'), NOW)).toBe(false));
  it('rejects old and future timestamps', () => {
    expect(verifyAgentMailSignature(body, sign(body), SECRET, NOW + 301)).toBe(false);
    expect(verifyAgentMailSignature(body, sign(body), SECRET, NOW - 301)).toBe(false);
    expect(verifyAgentMailSignature(body, sign(body), SECRET, NOW + 299)).toBe(true);
  });
  it('accepts when any of multiple signatures is valid', () => {
    const h = sign(body);
    const mixed = { ...h, 'svix-signature': `v1,${Buffer.from('junk').toString('base64')} ${h['svix-signature']}` };
    expect(verifyAgentMailSignature(body, mixed, SECRET, NOW)).toBe(true);
  });
  it('rejects missing or malformed headers', () => {
    const h = sign(body);
    for (const k of Object.keys(h)) expect(verifyAgentMailSignature(body, { ...h, [k]: undefined }, SECRET, NOW)).toBe(false);
    expect(verifyAgentMailSignature(body, { ...h, 'svix-timestamp': 'abc' }, SECRET, NOW)).toBe(false);
    expect(verifyAgentMailSignature(body, { ...h, 'svix-signature': 'garbage' }, SECRET, NOW)).toBe(false);
    expect(verifyAgentMailSignature(body, {}, SECRET, NOW)).toBe(false);
  });
});

describe('parseAgentMailWebhook', () => {
  const event = (type = 'message.received', thread = 'thr_1') => JSON.stringify({
    type: 'event', event_type: type, event_id: 'evt_1',
    message: { inbox_id: 'case1@agentmail.to', thread_id: thread, message_id: 'msg_9', from: `Dr <${TEST_EMAIL}>`, to: ['case1@agentmail.to'], subject: 'Re: hi', text: 'full text', extracted_text: 'Yes, call me.', timestamp: '2026-10-28T16:05:00Z' },
  });
  const now = () => new Date(NOW * 1000);
  const known = (id: string) => (id === 'thr_1' ? 'c1' : undefined);

  it('parses a reply on a known thread', async () => {
    const body = event();
    expect(await parseAgentMailWebhook(body, sign(body), SECRET, known, now)).toMatchObject({
      provider: 'agentmail', channel: 'email', eventType: 'message.received', eventId: 'evt_1', contactId: 'c1',
      inboxId: 'case1@agentmail.to', threadId: 'thr_1', messageId: 'msg_9', body: 'Yes, call me.', receivedAt: '2026-10-28T16:05:00.000Z', subject: 'Re: hi',
    });
  });
  it('rejects bad signatures with 401 and bad JSON with 400', async () => {
    const body = event();
    await expect(parseAgentMailWebhook(body, sign('other'), SECRET, known, now)).rejects.toMatchObject({ status: 401 });
    const bad = '{nope';
    await expect(parseAgentMailWebhook(bad, sign(bad), SECRET, known, now)).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unknown threads with 404', async () => {
    const body = event('message.received', 'thr_zzz');
    await expect(parseAgentMailWebhook(body, sign(body), SECRET, known, now)).rejects.toMatchObject({ status: 404 });
  });
  it('drops spam and other event types with 422', async () => {
    for (const t of ['message.received.spam', 'message.received.blocked', 'message.received.unauthenticated', 'message.sent']) {
      const body = event(t);
      await expect(parseAgentMailWebhook(body, sign(body), SECRET, known, now)).rejects.toMatchObject({ status: 422 });
    }
  });
});
