import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BODY_TOO_LARGE_TEXT, handleAgentCallWebhook, handleAgentMailWebhook, type InboundDeps } from '../../app/api/webhooks/_lib/inbound';
import { isUniqueViolation } from '../../app/api/webhooks/_lib/postgres';
import { createWebhookIngest } from '../../app/api/webhooks/_lib/ingest';
import { FixtureClassifier } from '../../lib/inbox/classifier';
import type { DraftContext } from '../../lib/inbox/drafts';
import { MemoryTaskStore } from '../../lib/inbox/task-store';
import { recordingSendEvents } from '../../lib/workflows/events';

const MAIL_SECRET = `whsec_${Buffer.from('mail-test-secret-bytes').toString('base64')}`;
const CALL_SECRET = 'call-test-secret';
const OWNER = { contactId: 'contact-1', caseId: 'case-1' };

function svixHeaders(body: string, opts: { secret?: string; ts?: number; id?: string } = {}) {
  const id = opts.id ?? 'msg_1';
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from((opts.secret ?? MAIL_SECRET).slice(6), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' };
}
const callHeaders = (body: string, secret = CALL_SECRET) => ({ 'x-agentcall-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` });
const post = (body: string, headers: Record<string, string>) => new Request('https://x.test/hook', { method: 'POST', body, headers });

function mailBody(message: Record<string, unknown> = {}, eventType = 'message.received') {
  return JSON.stringify({ type: 'event', event_type: eventType, event_id: 'evt_1', message: {
    inbox_id: 'inbox-1', thread_id: 'thread-1', message_id: 'pm-1', from: 'coord@site.test', subject: 'Re: hi',
    text: 'Yes, please call us.', timestamp: new Date().toISOString(), ...message } });
}

function setup(secret: string | null = MAIL_SECRET) {
  const { send, events } = recordingSendEvents();
  const stored: Parameters<InboundDeps['storeInboundMessage']>[0][] = [];
  const callEvents: Parameters<InboundDeps['storeCallEvent']>[0][] = [];
  const ingested: Parameters<InboundDeps['ingestInbound']>[0][] = [];
  const seen = new Set<string>();
  const deps: InboundDeps = {
    secret: secret ?? undefined,
    lookupThread: async id => id === 'thread-1' ? OWNER : undefined,
    lookupCall: async id => id === 'call-1' ? OWNER : undefined,
    storeInboundMessage: async m => { if (seen.has(m.providerMessageId)) return 'duplicate'; seen.add(m.providerMessageId); stored.push(m); return 'stored'; },
    storeCallEvent: async e => { callEvents.push(e); },
    sendEvents: send,
    ingestInbound: async (event) => { ingested.push(event); return { class: 'unclear' }; },
  };
  return { deps, stored, callEvents, events, ingested };
}

describe('ingestInbound (real inbox ingest, in-memory deps)', () => {
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', 'inbox', '01-needs-referral-basic.json'), 'utf8')) as { event: { body: string } };
  const ctx: DraftContext = {
    contactId: OWNER.contactId, caseId: OWNER.caseId, resourceName: 'Example Sarcoma Center',
    currentPhysician: { name: 'Dr. Local', email: 'local@example.test' },
    consent: { sharedFields: ['diagnosis'] }, caseRecord: { diagnosis: 'Synthetic rare sarcoma' },
  };
  const build = (storeDocument: (id: string, m: { body?: string; transcript?: string }) => Promise<unknown>) => {
    const tasks = new MemoryTaskStore();
    const ingest = createWebhookIngest({
      inbox: { classifier: new FixtureClassifier(), loadContext: () => ctx, tasks },
      storeDocument: storeDocument as never, onDocumentError: () => {},
    });
    return { tasks, ingest };
  };
  const event = { channel: 'email' as const, contactId: OWNER.contactId, caseId: OWNER.caseId, providerId: 'pm-1', providerThreadId: 'thread-1', body: fixture.event.body };

  it('classifies a verified reply, persists draft tasks that need approval, and stores the document', async () => {
    const docs: unknown[][] = [];
    const { tasks, ingest } = build(async (...a) => { docs.push(a); });
    const result = await ingest(event);
    expect(result.classification.class).toBe('needs_referral');
    expect(result.tasks[0]).toMatchObject({ kind: 'referral', status: 'open', requiresApproval: true });
    expect(await tasks.task(result.tasks[0]!.id)).toBeDefined();
    expect(docs).toEqual([[OWNER.contactId, expect.objectContaining({ body: fixture.event.body })]]);
  });

  it('keeps unknown text as unclear', async () => {
    const { ingest } = build(async () => undefined);
    const result = await ingest({ ...event, body: 'never seen before' });
    expect(result.classification.class).toBe('unclear');
  });

  it('does not fail when the case document store fails', async () => {
    const { ingest } = build(async () => { throw new Error('store down'); });
    await expect(ingest(event)).resolves.toMatchObject({ contactId: OWNER.contactId });
  });

  it('stores voice transcripts as transcripts', async () => {
    const docs: unknown[][] = [];
    const { ingest } = build(async (...a) => { docs.push(a); });
    await ingest({ ...event, channel: 'voice', providerId: 'call-1', providerThreadId: undefined });
    expect(docs[0]![1]).toEqual({ transcript: fixture.event.body });
  });
});

describe('provider message dedupe', () => {
  it('treats a unique violation as an already-processed insert', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });
});

describe('AgentMail webhook', () => {
  it('rejects missing and invalid signatures with 401, storing nothing', async () => {
    const { deps, stored, events } = setup();
    const body = mailBody();
    expect((await handleAgentMailWebhook(post(body, {}), deps)).status).toBe(401);
    const bad = svixHeaders(body, { secret: `whsec_${Buffer.from('other').toString('base64')}` });
    const res = await handleAgentMailWebhook(post(body, bad), deps);
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
    expect(stored).toHaveLength(0); expect(events).toHaveLength(0);
  });

  it('rejects a tampered body and a stale timestamp', async () => {
    const { deps, stored, events } = setup();
    const body = mailBody();
    expect((await handleAgentMailWebhook(post(body + ' ', svixHeaders(body)), deps)).status).toBe(401);
    const stale = svixHeaders(body, { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect((await handleAgentMailWebhook(post(body, stale), deps)).status).toBe(401);
    expect(stored).toHaveLength(0); expect(events).toHaveLength(0);
  });

  it('503s when the secret is not configured', async () => {
    const { deps, stored, events } = setup(null);
    const body = mailBody();
    const res = await handleAgentMailWebhook(post(body, svixHeaders(body)), deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ reasons: ['webhook_secret_not_configured'] });
    expect(stored).toHaveLength(0); expect(events).toHaveLength(0);
  });

  it('404s for an unknown thread and stores nothing', async () => {
    const { deps, stored, events } = setup();
    const body = mailBody({ thread_id: 'stranger' });
    expect((await handleAgentMailWebhook(post(body, svixHeaders(body)), deps)).status).toBe(404);
    expect(stored).toHaveLength(0); expect(events).toHaveLength(0);
  });

  it('400s on malformed payload', async () => {
    const { deps } = setup();
    const body = JSON.stringify({ event_type: 'message.received', message: {} });
    expect((await handleAgentMailWebhook(post(body, svixHeaders(body)), deps)).status).toBe(400);
    const junk = 'not json';
    expect((await handleAgentMailWebhook(post(junk, svixHeaders(junk)), deps)).status).toBe(400);
  });

  it('stores a reply once and emits exactly one contact reply event', async () => {
    const { deps, stored, events, ingested } = setup();
    const body = mailBody();
    const res = await handleAgentMailWebhook(post(body, svixHeaders(body)), deps);
    expect(res.status).toBe(200);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ contactId: 'contact-1', providerThreadId: 'thread-1', providerMessageId: 'pm-1', body: 'Yes, please call us.' });
    expect(events).toHaveLength(1);
    const ev = JSON.stringify(events[0]);
    expect(ev).toContain('contact-1'); expect(ev).toContain('case-1'); expect(ev).toContain('contact-reply-pm-1');
    expect(ingested).toEqual([expect.objectContaining({ channel: 'email', contactId: 'contact-1', caseId: 'case-1', providerId: 'pm-1', body: 'Yes, please call us.' })]);
  });

  it('treats a duplicate delivery as 200 duplicate without a second event', async () => {
    const { deps, stored, events, ingested } = setup();
    const body = mailBody();
    await handleAgentMailWebhook(post(body, svixHeaders(body)), deps);
    const res = await handleAgentMailWebhook(post(body, svixHeaders(body, { id: 'msg_2' })), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ duplicate: true });
    expect(stored).toHaveLength(1); expect(events).toHaveLength(1);
    expect(ingested).toHaveLength(1);
  });

  it('stores a placeholder and still emits when the body arrives as body_url', async () => {
    const { deps, stored, events } = setup();
    const body = mailBody({ text: undefined, body_url: 'https://files.agentmail.test/big' });
    const fetched: unknown[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (...a: unknown[]) => { fetched.push(a); throw new Error('no network'); }) as typeof fetch;
    try {
      const res = await handleAgentMailWebhook(post(body, svixHeaders(body)), deps);
      expect(res.status).toBe(200);
    } finally { globalThis.fetch = orig; }
    expect(fetched).toHaveLength(0);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ body: BODY_TOO_LARGE_TEXT, classification: 'body_too_large' });
    expect(events).toHaveLength(1);
  });

  it('acknowledges ignored event types with 200 ignored', async () => {
    const { deps, stored, events } = setup();
    const body = mailBody({}, 'message.sent');
    const res = await handleAgentMailWebhook(post(body, svixHeaders(body)), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(stored).toHaveLength(0); expect(events).toHaveLength(0);
  });
});

describe('AgentCall webhook', () => {
  const transcriptBody = () => JSON.stringify({ event: 'call.transcript', timestamp: '2026-10-01T12:00:00.000Z', data: {
    callId: 'call-1', transcript: [{ role: 'ai', text: 'Hello' }, { role: 'human', text: 'Hi there' }] } });
  const statusBody = (callId = 'call-1') => JSON.stringify({ event: 'call.status', timestamp: '2026-10-01T12:00:00.000Z', data: { callId, status: 'ringing' } });

  it('rejects bad/missing signature (401) and missing secret (503)', async () => {
    const { deps, callEvents, events } = setup(CALL_SECRET);
    const body = transcriptBody();
    expect((await handleAgentCallWebhook(post(body, {}), deps)).status).toBe(401);
    expect((await handleAgentCallWebhook(post(body, callHeaders(body, 'wrong')), deps)).status).toBe(401);
    expect(callEvents).toHaveLength(0); expect(events).toHaveLength(0);
    const none = setup(null);
    expect((await handleAgentCallWebhook(post(body, callHeaders(body)), none.deps)).status).toBe(503);
    expect(none.callEvents).toHaveLength(0);
  });

  it('stores the transcript and emits exactly one reply event', async () => {
    const { deps, callEvents, events, ingested } = setup(CALL_SECRET);
    const body = transcriptBody();
    const res = await handleAgentCallWebhook(post(body, callHeaders(body)), deps);
    expect(res.status).toBe(200);
    expect(callEvents).toHaveLength(1);
    expect(callEvents[0]).toMatchObject({ contactId: 'contact-1', providerCallId: 'call-1', transcript: 'AI: Hello\nCallee: Hi there' });
    expect(callEvents[0]!.endedAt).toBeInstanceOf(Date);
    expect(events).toHaveLength(1);
    const ev = JSON.stringify(events[0]);
    expect(ev).toContain('contact-reply-call-1-transcript'); expect(ev).toContain('case-1');
    expect(ingested).toEqual([expect.objectContaining({ channel: 'voice', contactId: 'contact-1', providerId: 'call-1', body: 'AI: Hello\nCallee: Hi there' })]);
  });

  it('stores call.status without emitting', async () => {
    const { deps, callEvents, events } = setup(CALL_SECRET);
    const body = statusBody();
    expect((await handleAgentCallWebhook(post(body, callHeaders(body)), deps)).status).toBe(200);
    expect(callEvents).toEqual([{ contactId: 'contact-1', providerCallId: 'call-1', eventType: 'call.status', status: 'ringing' }]);
    expect(events).toHaveLength(0);
  });

  it('404s for an unknown call and ignores other events', async () => {
    const { deps, callEvents, events } = setup(CALL_SECRET);
    const unknown = statusBody('call-x');
    expect((await handleAgentCallWebhook(post(unknown, callHeaders(unknown)), deps)).status).toBe(404);
    const other = JSON.stringify({ event: 'call.recording', data: { callId: 'call-1' } });
    const res = await handleAgentCallWebhook(post(other, callHeaders(other)), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(callEvents).toHaveLength(0); expect(events).toHaveLength(0);
  });
});

describe('contacts sharing one coordinator inbox (demo mode)', () => {
  it('routes each reply to its own contact by provider thread id, not by the from-address', async () => {
    const a = { contactId: 'contact-a', caseId: 'case-1' };
    const b = { contactId: 'contact-b', caseId: 'case-1' };
    const { deps, stored, ingested } = setup();
    deps.lookupThread = async id => (id === 'thread-a' ? a : id === 'thread-b' ? b : undefined);
    const from = 'la-county-dpss-demo@agentmail.to'; // identical sender for both contacts
    const replyA = mailBody({ thread_id: 'thread-a', message_id: 'pm-a', from, text: 'Reply for A' });
    const replyB = mailBody({ thread_id: 'thread-b', message_id: 'pm-b', from, text: 'Reply for B' });
    expect((await handleAgentMailWebhook(post(replyB, svixHeaders(replyB, { id: 'msg_b' })), deps)).status).toBe(200);
    expect((await handleAgentMailWebhook(post(replyA, svixHeaders(replyA, { id: 'msg_a' })), deps)).status).toBe(200);
    expect(stored.map(m => [m.contactId, m.body])).toEqual([['contact-b', 'Reply for B'], ['contact-a', 'Reply for A']]);
    expect(ingested.map(e => e.contactId)).toEqual(['contact-b', 'contact-a']);
  });
});
