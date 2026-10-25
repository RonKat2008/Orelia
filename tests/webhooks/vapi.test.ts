import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryIngestLedger, type InboundDeps } from '../../app/api/webhooks/_lib/inbound';
import { createWebhookIngest, idempotentIngest } from '../../app/api/webhooks/_lib/ingest';
import { handleVapiWebhook, type VapiInboundDeps } from '../../app/api/webhooks/_lib/vapi';
import { FixtureClassifier } from '../../lib/inbox/classifier';
import type { DraftContext } from '../../lib/inbox/drafts';
import { MemoryTaskStore } from '../../lib/inbox/task-store';
import { memoryCallLiveStore, toView } from '../../lib/outreach/call-live';
import { AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';
import { recordingSendEvents } from '../../lib/workflows/events';

const SECRET = 'vapi-test-secret';
const OWNER = { contactId: 'contact-1', caseId: 'case-1' };
const LISTEN = 'wss://aws.vapi.ai/listen/abc';
const call = { id: 'vcall-1', monitor: { listenUrl: LISTEN } };
const post = (body: string, headers: Record<string, string> = { 'x-vapi-secret': SECRET }) =>
  new Request('https://x.test/api/webhooks/vapi', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
const msg = (message: Record<string, unknown>) => JSON.stringify({ message: { call, ...message } });

function setup(opts: { secret?: string | null; ingestInbound?: InboundDeps['ingestInbound'] } = {}) {
  const { send, events } = recordingSendEvents();
  const callEvents: Parameters<InboundDeps['storeCallEvent']>[0][] = [];
  const ingested: Parameters<InboundDeps['ingestInbound']>[0][] = [];
  const live = memoryCallLiveStore();
  const deps: VapiInboundDeps = {
    secret: opts.secret === null ? undefined : opts.secret ?? SECRET,
    lookupCall: async id => (id === 'vcall-1' ? OWNER : undefined),
    storeCallEvent: async e => { callEvents.push(e); },
    sendEvents: send,
    ingestLedger: memoryIngestLedger(),
    ingestInbound: opts.ingestInbound ?? (async e => { ingested.push(e); return {}; }),
    live,
  };
  return { deps, callEvents, ingested, events, live, key: { providerCallId: 'vcall-1', contactId: OWNER.contactId } };
}

const report = (messages: { role: string; message: string; time: number }[], extra: Record<string, unknown> = {}) =>
  msg({ type: 'end-of-call-report', endedReason: 'customer-ended-call', endedAt: '2026-10-24T20:00:00.000Z', analysis: { summary: 'Summary.' }, artifact: { messages }, ...extra });

describe('Vapi webhook auth (fails closed)', () => {
  it('503 when no secret is configured, 401 on a missing or wrong secret; nothing stored', async () => {
    const body = msg({ type: 'status-update', status: 'ringing' });
    const none = setup({ secret: null });
    expect((await handleVapiWebhook(post(body), none.deps)).status).toBe(503);
    const s = setup();
    expect((await handleVapiWebhook(post(body, {}), s.deps)).status).toBe(401);
    expect((await handleVapiWebhook(post(body, { 'x-vapi-secret': 'wrong' }), s.deps)).status).toBe(401);
    expect((await handleVapiWebhook(post(body, { authorization: 'Bearer wrong' }), s.deps)).status).toBe(401);
    expect(s.callEvents).toHaveLength(0);
    expect(s.live.state(s.key)).toBeUndefined();
    expect((await handleVapiWebhook(post(body, { authorization: `Bearer ${SECRET}` }), s.deps)).status).toBe(200);
  });

  it('rejects malformed bodies (400) and unknown calls (404)', async () => {
    const s = setup();
    expect((await handleVapiWebhook(post('{bad'), s.deps)).status).toBe(400);
    const other = JSON.stringify({ message: { type: 'status-update', status: 'ringing', call: { id: 'not-ours' } } });
    expect((await handleVapiWebhook(post(other), s.deps)).status).toBe(404);
    expect(s.callEvents).toHaveLength(0);
  });
});

describe('Vapi webhook live state and turns', () => {
  it('status-update stores live status, listen URL and calls.outcome', async () => {
    const s = setup();
    expect((await handleVapiWebhook(post(msg({ type: 'status-update', status: 'in-progress' })), s.deps)).status).toBe(200);
    expect(s.live.state(s.key)).toEqual({ provider: 'vapi', status: 'in-progress', listenUrl: LISTEN });
    expect(s.callEvents).toEqual([{ contactId: 'contact-1', providerCallId: 'vcall-1', eventType: 'call.status', status: 'in-progress' }]);
    await handleVapiWebhook(post(msg({ type: 'status-update', status: 'ended', endedReason: 'voicemail' })), s.deps);
    expect(s.callEvents[1]).toMatchObject({ status: 'voicemail' });
  });

  it('stores final turns as they arrive, idempotently', async () => {
    const s = setup();
    const turn = msg({ type: 'transcript', transcriptType: 'final', role: 'assistant', transcript: AI_DISCLOSURE_VOICE, timestamp: 1790000000000 });
    expect(await (await handleVapiWebhook(post(turn), s.deps)).json()).toEqual({ ok: true });
    expect(await (await handleVapiWebhook(post(turn), s.deps)).json()).toEqual({ duplicate: true });
    await handleVapiWebhook(post(msg({ type: 'transcript', transcriptType: 'final', role: 'user', transcript: 'Hello?', timestamp: 1790000001000 })), s.deps);
    await handleVapiWebhook(post(msg({ type: 'transcript', transcriptType: 'partial', role: 'user', transcript: 'Hel', timestamp: 1790000000500 })), s.deps);
    expect(s.live.turns(s.key).map(t => [t.role, t.text])).toEqual([['ai', AI_DISCLOSURE_VOICE], ['human', 'Hello?']]);
    expect(s.ingested).toHaveLength(0);
  });

  it('the read model shows the listen URL only to the judge view', () => {
    const row = { id: 'r1', contactId: 'c', startedAt: new Date(), endedAt: null, outcome: null, transcript: null, provider: 'vapi', status: 'in-progress', endedReason: null, summary: null, listenUrl: LISTEN };
    expect(toView(row, [], false)).not.toHaveProperty('listenUrl');
    expect(toView(row, [], true)).toMatchObject({ listenUrl: LISTEN, live: true });
  });
});

describe('Vapi end-of-call-report', () => {
  const human = [
    { role: 'bot', message: AI_DISCLOSURE_VOICE, time: 1 },
    { role: 'user', message: 'We need a referral.', time: 2 },
  ];

  it('stores the transcript like AgentCall, ingests once and emits one reply event (idempotent)', async () => {
    const s = setup();
    const body = report(human);
    expect((await handleVapiWebhook(post(body), s.deps)).status).toBe(200);
    expect(await (await handleVapiWebhook(post(body), s.deps)).json()).toEqual({ duplicate: true });
    expect(s.callEvents[0]).toEqual({
      contactId: 'contact-1', providerCallId: 'vcall-1', eventType: 'call.transcript',
      transcript: `AI: ${AI_DISCLOSURE_VOICE}\nCallee: We need a referral.`, endedAt: new Date('2026-10-24T20:00:00.000Z'), status: 'customer-ended-call',
    });
    expect(s.ingested).toHaveLength(1);
    expect(s.ingested[0]).toMatchObject({ channel: 'voice', contactId: 'contact-1', caseId: 'case-1', providerId: 'vcall-1' });
    expect(s.events.filter(e => e.name === 'contact/reply')).toHaveLength(1);
    expect(s.live.state(s.key)).toMatchObject({ status: 'ended', endedReason: 'customer-ended-call', summary: 'Summary.' });
    expect(s.live.turns(s.key)).toHaveLength(2);
  });

  it('does not duplicate turns that already arrived live', async () => {
    const s = setup();
    await handleVapiWebhook(post(msg({ type: 'transcript', transcriptType: 'final', role: 'assistant', transcript: AI_DISCLOSURE_VOICE, timestamp: 1 })), s.deps);
    await handleVapiWebhook(post(report(human)), s.deps);
    expect(s.live.turns(s.key)).toHaveLength(1);
  });

  it('voicemail (no human speech): stored, but no task and no reply event', async () => {
    const s = setup();
    const res = await handleVapiWebhook(post(report([{ role: 'bot', message: AI_DISCLOSURE_VOICE, time: 1 }], { endedReason: 'voicemail' })), s.deps);
    expect(await res.json()).toMatchObject({ ingested: false, reason: 'no_human_speech' });
    expect(s.callEvents[0]).toMatchObject({ status: 'voicemail' });
    expect(s.ingested).toHaveLength(0);
    expect(s.events).toHaveLength(0);
  });

  it('a failed ingest releases the claim so the retry ingests', async () => {
    let fail = true;
    const s = setup({ ingestInbound: async () => { if (fail) throw new Error('db down'); return {}; } });
    expect((await handleVapiWebhook(post(report(human)), s.deps)).status).toBe(500);
    fail = false;
    expect(await (await handleVapiWebhook(post(report(human)), s.deps)).json()).toEqual({ ok: true });
  });

  it('maps a Vapi transcript into inbox tasks through the real ingest', async () => {
    const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', 'inbox', '08-call-to-schedule-voice.json'), 'utf8')) as { event: { body: string } };
    const messages = fixture.event.body.split('\n').map((line, i) => {
      const [who, ...rest] = line.split(': ');
      return { role: who === 'AI' ? 'bot' : 'user', message: rest.join(': '), time: i + 1 };
    });
    const ctx: DraftContext = {
      contactId: OWNER.contactId, caseId: OWNER.caseId, resourceName: 'Example Center',
      consent: { sharedFields: ['diagnosis'] }, caseRecord: { diagnosis: 'Synthetic rare sarcoma' },
    };
    const tasks = new MemoryTaskStore();
    const ingest = createWebhookIngest({ inbox: { classifier: new FixtureClassifier(), loadContext: () => ctx, tasks }, onDocumentError: () => {} });
    const results: unknown[] = [];
    const s = setup({ ingestInbound: async e => { const r = await idempotentIngest(tasks, (ev, sourceId) => ingest({ ...ev, sourceId }))(e); results.push(r); return r; } });
    expect((await handleVapiWebhook(post(report(messages)), s.deps)).status).toBe(200);
    expect(s.ingested).toHaveLength(0);
    const result = results[0] as { classification: { class: string }; tasks: { id: string; kind: string }[] };
    expect(result.classification.class).toBe('call_to_schedule');
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(await tasks.task(result.tasks[0]!.id)).toBeDefined();
  });
});
