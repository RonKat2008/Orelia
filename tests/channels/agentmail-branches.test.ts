/* eslint-disable @typescript-eslint/no-explicit-any -- loose AgentMail client double */
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AgentMailClient } from 'agentmail';
import { AgentMailChannel, parseAgentMailWebhook, verifyAgentMailSignature } from '@/lib/channels/agentmail';
import { ChannelError } from '@/lib/channels/types';
import { gatedEmail, guard } from './helpers';

const API_KEY = 'am_test_BRANCHKEY456';

function fakeClient(over: { create?: any; send?: any; reply?: any; get?: any } = {}) {
  const create = over.create ?? vi.fn(async () => ({ inboxId: 'inbox-1', email: 'case@agentmail.to' }));
  const send = over.send ?? vi.fn(async () => ({ threadId: 'thr-1', messageId: 'msg-1' }));
  const reply = over.reply ?? vi.fn(async () => ({ threadId: 'thr-1', messageId: 'msg-2' }));
  const get = over.get ?? vi.fn(async () => ({ messages: [] }));
  const client = { inboxes: { create, messages: { send, reply } }, threads: { get } } as unknown as AgentMailClient;
  return { client, create, send, reply, get };
}
const makeChannel = (over: Parameters<typeof fakeClient>[0] = {}, opts: { inboxDomain?: string; apiKey?: string } = {}) => {
  const f = fakeClient(over);
  const channel = new AgentMailChannel({ client: f.client, guard, ...opts });
  return { ...f, channel };
};

describe('AgentMailChannel construction', () => {
  it('requires an apiKey or a client', () => {
    expect(() => new AgentMailChannel({ guard })).toThrow(/apiKey or client is required/);
  });

  it('builds its own client from an apiKey without a custom fetcher', () => {
    const channel = new AgentMailChannel({ apiKey: API_KEY, guard });
    expect(channel.kind).toBe('email');
  });
});

describe('AgentMailChannel inbox + send branches', () => {
  it('passes the configured inbox domain when creating an inbox', async () => {
    const { channel, create } = makeChannel({}, { inboxDomain: 'mail.example.org' });

    await channel.createCaseInbox('case-1');

    expect(create.mock.calls[0][0]).toMatchObject({ domain: 'mail.example.org', clientId: 'wayfinder-case-case-1' });
  });

  it('omits the domain when none is configured', async () => {
    const { channel, create } = makeChannel();

    await channel.createCaseInbox('case-1');

    expect('domain' in create.mock.calls[0][0]).toBe(false);
  });

  it('maps inbox creation failures to ChannelError', async () => {
    const { channel } = makeChannel({ create: vi.fn(async () => { throw { statusCode: 500 }; }) });

    await expect(channel.createCaseInbox('case-1')).rejects.toMatchObject({ status: 500, retryable: true });
  });

  it('sends without subject or contact labels when the draft has neither', async () => {
    const draft = gatedEmail({ caseId: 'case-1' });
    const { channel, send } = makeChannel();

    const ref = await channel.send(draft);

    const body = send.mock.calls[0][1];
    expect(body.labels).toEqual(['wayfinder', 'case:case-1']);
    expect(ref).toMatchObject({ threadId: 'thr-1', messageId: 'msg-1', status: 'sent', inboxId: 'inbox-1' });
  });

  it('includes the subject and contact label when present', async () => {
    const { channel, send } = makeChannel();

    await channel.send(gatedEmail({ caseId: 'case-1', contactId: 'c1', subject: 'Hello' }));

    expect(send.mock.calls[0][1]).toMatchObject({ subject: 'Hello', labels: ['wayfinder', 'case:case-1', 'contact:c1'] });
  });

  it('maps send failures that carry no status to a retryable error', async () => {
    const { channel } = makeChannel({ send: vi.fn(async () => { throw new Error('socket hang up'); }) });

    const err = await channel.send(gatedEmail({ caseId: 'case-1' })).catch(e => e);

    expect(err).toMatchObject({ message: 'agentmail: request failed', retryable: true });
    expect(err.status).toBeUndefined();
  });

  it('replies in-thread using the thread inbox when given', async () => {
    const { channel, reply, create } = makeChannel();

    await channel.send(gatedEmail({ caseId: 'case-1', contactId: 'c1' }), { inboxId: 'inbox-x', messageId: 'm-9' });

    expect(create).not.toHaveBeenCalled();
    expect(reply.mock.calls[0].slice(0, 2)).toEqual(['inbox-x', 'm-9']);
  });

  it('replies in-thread by creating the case inbox when the thread has no inbox id', async () => {
    const { channel, reply, create } = makeChannel();

    await channel.sendInThread(gatedEmail({ caseId: 'case-1' }), { inboxId: undefined as unknown as string, messageId: 'm-9' });

    expect(create).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toBe('inbox-1');
  });

  it('maps reply failures, including a 404 with no JSON body', async () => {
    const { channel } = makeChannel({ reply: vi.fn(async () => { throw { statusCode: 404, body: 'not json' }; }) });

    const err = await channel.send(gatedEmail({ caseId: 'case-1' }), { inboxId: 'i', messageId: 'm' }).catch(e => e);

    expect(err).toMatchObject({ status: 404, retryable: false, message: 'agentmail: HTTP 404' });
  });

  it('refuses an email draft without a caseId', async () => {
    const { channel, send } = makeChannel();

    await expect(channel.send(gatedEmail())).rejects.toThrow(/without a caseId/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('AgentMailChannel error mapping', () => {
  const failWith = (e: unknown, opts: { apiKey?: string } = {}) => {
    const { channel } = makeChannel({ send: vi.fn(async () => { throw e; }) }, opts);
    return channel.send(gatedEmail({ caseId: 'case-1' })).catch(err => err);
  };

  it('passes an existing ChannelError through untouched', async () => {
    const original = new ChannelError('agentmail', 'already mapped', 418);
    expect(await failWith(original)).toBe(original);
  });

  it('handles null and non-object thrown values', async () => {
    expect(await failWith(null)).toMatchObject({ retryable: true, message: 'agentmail: request failed' });
    expect(await failWith('boom')).toMatchObject({ retryable: true });
  });

  it('uses a numeric provider code and falls back to the error name', async () => {
    expect(await failWith({ statusCode: 400, body: { code: 1234, message: 'm' } })).toMatchObject({ body: { code: 1234 } });
    expect(await failWith({ statusCode: 400, body: { name: 'ValidationError', message: 'm' } })).toMatchObject({ body: { code: 'ValidationError', name: 'ValidationError' } });
  });

  it('ignores a non-string message and a non-string code', async () => {
    const err = await failWith({ statusCode: 422, body: { message: 42, code: { x: 1 } } });
    expect(err).toMatchObject({ message: 'agentmail: HTTP 422', retryable: false, body: {} });
  });

  it('does not treat 4xx other than 429 as retryable but does for 429 and 500', async () => {
    expect((await failWith({ statusCode: 403 })).retryable).toBe(false);
    expect((await failWith({ statusCode: 429 })).retryable).toBe(true);
    expect((await failWith({ statusCode: 502 })).retryable).toBe(true);
  });

  it('redacts the api key when one is configured, and leaves text alone otherwise', async () => {
    const leaky = { statusCode: 401, body: { message: `key ${API_KEY} rejected` } };
    const f = fakeClient({ send: vi.fn(async () => { throw leaky; }) });
    // A channel that was built from an apiKey remembers it for redaction.
    const withKey = new AgentMailChannel({ apiKey: API_KEY, guard, fetcher: vi.fn() as any });
    (withKey as any).client = f.client;

    const redacted = await withKey.send(gatedEmail({ caseId: 'case-1' })).catch(e => e);
    const plain = await failWith(leaky);

    expect(redacted.message).toBe('agentmail: key [redacted] rejected');
    expect(plain.message).toContain(API_KEY);
  });
});

describe('AgentMailChannel.listThreadMessages', () => {
  const ts = (s: string) => new Date(s);

  it('omits subject and text when the provider does not return them', async () => {
    const { channel } = makeChannel({ get: vi.fn(async () => ({ messages: [{ messageId: 'm1', from: 'a@example.com', to: ['b@example.com'], timestamp: ts('2026-10-28T16:00:00Z') }] })) });

    const msgs = await channel.listThreadMessages('thr-1', () => 'c1');

    expect(msgs).toEqual([{ messageId: 'm1', from: 'a@example.com', to: ['b@example.com'], timestamp: '2026-10-28T16:00:00.000Z' }]);
  });

  it('accepts an async known-thread lookup and maps provider failures', async () => {
    const { channel } = makeChannel({ get: vi.fn(async () => { throw { statusCode: 503 }; }) });

    await expect(channel.listThreadMessages('thr-1', async () => 'c1')).rejects.toMatchObject({ status: 503, retryable: true });
  });
});

describe('verifyAgentMailSignature edge cases', () => {
  const body = '{"a":1}';
  const NOW = 1_800_000_000;
  const raw = 'edge-secret';
  const SECRET = 'whsec_' + Buffer.from(raw).toString('base64');
  const sig = (secretRaw = raw, id = 'id1', ts = NOW) =>
    createHmac('sha256', Buffer.from(secretRaw)).update(`${id}.${ts}.${body}`).digest('base64');
  const headers = (signature: string) => ({ 'svix-id': 'id1', 'svix-timestamp': String(NOW), 'svix-signature': signature });

  it('accepts a secret without the whsec_ prefix', () => {
    expect(verifyAgentMailSignature(body, headers(`v1,${sig()}`), Buffer.from(raw).toString('base64'), NOW)).toBe(true);
  });

  it('rejects an empty secret and a secret that decodes to nothing', () => {
    expect(verifyAgentMailSignature(body, headers(`v1,${sig()}`), '', NOW)).toBe(false);
    expect(verifyAgentMailSignature(body, headers(`v1,${sig()}`), 'whsec_', NOW)).toBe(false);
  });

  it('skips signatures with another version, no value, or the wrong length', () => {
    expect(verifyAgentMailSignature(body, headers(`v2,${sig()}`), SECRET, NOW)).toBe(false);
    expect(verifyAgentMailSignature(body, headers('v1,'), SECRET, NOW)).toBe(false);
    expect(verifyAgentMailSignature(body, headers(`v1,${Buffer.from('short').toString('base64')}`), SECRET, NOW)).toBe(false);
  });

  it('reads the first value of array-valued header bags', () => {
    const h = { 'svix-id': ['id1', 'ignored'], 'svix-timestamp': [String(NOW)], 'svix-signature': [`v1,${sig()}`] };
    expect(verifyAgentMailSignature(body, h as any, SECRET, NOW)).toBe(true);
  });

  it('uses the wall clock by default (a fixed old timestamp is rejected)', () => {
    expect(verifyAgentMailSignature(body, headers(`v1,${sig()}`), SECRET)).toBe(false);
  });
});

describe('parseAgentMailWebhook edge cases', () => {
  const SECRET = 'whsec_' + Buffer.from('hook-secret').toString('base64');
  const NOW = 1_800_000_000;
  const now = () => new Date(NOW * 1000);
  const known = () => 'c1';
  const signed = (body: string) => {
    const sig = createHmac('sha256', Buffer.from('hook-secret')).update(`id9.${NOW}.${body}`).digest('base64');
    return { 'svix-id': 'id9', 'svix-timestamp': String(NOW), 'svix-signature': `v1,${sig}` };
  };
  const parse = (payload: unknown, isKnown: (id: string) => string | undefined | Promise<string | undefined> = known, clock = now) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return parseAgentMailWebhook(body, signed(body), SECRET, isKnown, clock);
  };
  const message = (over: Record<string, unknown> = {}) => ({ thread_id: 'thr-1', message_id: 'msg-1', ...over });

  it('rejects a JSON null body as malformed', async () => {
    await expect(parse('null')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects message.received without a usable message object', async () => {
    await expect(parse({ event_type: 'message.received' })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ event_type: 'message.received', message: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ event_type: 'message.received', message: { message_id: 'm' } })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ event_type: 'message.received', message: { thread_id: 't' } })).rejects.toMatchObject({ status: 400 });
  });

  it('reports a missing event type in the 422', async () => {
    await expect(parse({})).rejects.toMatchObject({ status: 422, message: 'agentmail: ignoring event undefined' });
  });

  it('falls back to text, then empty string, and omits absent optional fields', async () => {
    const withText = await parse({ event_type: 'message.received', message: message({ text: 'plain body', timestamp: 1_800_000_100_000 }) });
    const empty = await parse({ event_type: 'message.received', message: message() });

    expect(withText.body).toBe('plain body');
    expect(withText.receivedAt).toBe(new Date(1_800_000_100_000).toISOString());
    expect(empty.body).toBe('');
    expect(Object.keys(empty)).not.toEqual(expect.arrayContaining(['eventId', 'inboxId', 'from', 'subject']));
  });

  it('uses the injected clock when the timestamp is missing or invalid', async () => {
    const missing = await parse({ event_type: 'message.received', message: message() });
    const invalid = await parse({ event_type: 'message.received', message: message({ timestamp: 'not-a-date' }) });
    const wrongType = await parse({ event_type: 'message.received', message: message({ timestamp: { a: 1 } }) });

    for (const r of [missing, invalid, wrongType]) expect(r.receivedAt).toBe(now().toISOString());
  });

  it('uses the real clock when none is injected', async () => {
    const body = JSON.stringify({ event_type: 'message.received', message: message() });
    const sig = createHmac('sha256', Buffer.from('hook-secret')).update(`id9.${Math.floor(Date.now() / 1000)}.${body}`).digest('base64');
    const headers = { 'svix-id': 'id9', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': `v1,${sig}` };

    const res = await parseAgentMailWebhook(body, headers, SECRET, known);

    expect(res.contactId).toBe('c1');
  });

  it('copies string identity fields and ignores non-string ones', async () => {
    const full = await parse({ event_id: 'e1', event_type: 'message.received', message: message({ inbox_id: 'in', from: 'a@example.com', subject: 'S' }) });
    const odd = await parse({ event_id: 5, event_type: 'message.received', message: message({ inbox_id: 1, from: ['x'], subject: 9 }) });

    expect(full).toMatchObject({ eventId: 'e1', inboxId: 'in', from: 'a@example.com', subject: 'S' });
    expect('eventId' in odd || 'inboxId' in odd || 'from' in odd || 'subject' in odd).toBe(false);
  });

  it('supports an async known-thread lookup that returns nothing', async () => {
    await expect(parse({ event_type: 'message.received', message: message() }, async () => undefined)).rejects.toMatchObject({ status: 404 });
  });
});
