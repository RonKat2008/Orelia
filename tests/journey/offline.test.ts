import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as intake } from '@/app/api/cases/route';
import { PATCH as confirm } from '@/app/api/cases/[id]/route';
import { GET as shortlist } from '@/app/api/cases/[id]/shortlist/route';
import type { Services } from '@/app/api/cases/_lib/services';
import { MemoryCaseStore } from '@/lib/agents/case-store';
import { MemoryPersist } from '@/lib/agents/persist';
import { MemoryRunStore } from '@/lib/agents/run-store';
import { MemoryCurationStore } from '@/lib/agents/curator-store';
import { runResearch } from '@/lib/agents/orchestrator';
import { researchAgents } from '@/lib/agents/research';
import { createFixturePorts } from '@/lib/agents/research/fixture-ports';
import { OutreachService } from '@/lib/outreach/service';
import { outreachHandlers } from '@/lib/outreach/http';
import { MockMailer } from '@/lib/channels/mock-mailer';
import { MockCaller } from '@/lib/channels/mock-caller';
import { checkOutbound, type GatedDraft } from '@/lib/safety/outbound-gate';
import { hasDisclosure, AI_DISCLOSURE_VOICE } from '@/lib/safety/disclosure';
import { MemoryTaskStore } from '@/lib/inbox/task-store';
import { MemoryInboundMessageStore } from '@/lib/inbox/inbound-store';
import { FixtureClassifier } from '@/lib/inbox/classifier';
import { ingestInbound } from '@/lib/inbox/ingest';
import { inboxHandlers } from '@/lib/inbox/http';
import { handleAgentMailWebhook, memoryIngestLedger, type InboundDeps } from '@/app/api/webhooks/_lib/inbound';
import { createConnectionWorkflow } from '@/lib/workflows/connection-workflow';
import { InMemoryContactContextStore } from '@/lib/workflows/contact-store';
import { initialContext, transition } from '@/lib/workflows/connection-machine';
import type { WorkflowStep } from '@/lib/workflows/engine';
import { MemoryJourneyStore } from '../helpers/journey/store';

// Same-origin requests carrying the wf_session cookie issued on case creation (the ownership guard is never bypassed).
let sessionCookie = '';
const request = (data: unknown) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(data), headers: { origin: 'http://localhost', ...(sessionCookie ? { cookie: sessionCookie } : {}) } });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const globals = globalThis as typeof globalThis & { __wayfinderServices?: Services; __wayfinderCurations?: MemoryCurationStore };
const secret = `whsec_${Buffer.from('journey-test-secret').toString('base64')}`;
function signed(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`journey.${timestamp}.${body}`).digest('base64');
  return new Request('http://localhost/webhook', { method: 'POST', body, headers: { 'svix-id': 'journey', 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } });
}

beforeEach(() => {
  sessionCookie = '';
  vi.stubEnv('WAYFINDER_OFFLINE', '1');
  vi.stubEnv('WAYFINDER_SESSION_SECRET', 'journey-session-secret');
  vi.stubEnv('DATABASE_URL', '');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-02T14:00:00Z')); // Monday; includes weekend crossings.
  globals.__wayfinderServices = { cases: new MemoryCaseStore(), runs: new MemoryRunStore(), persist: new MemoryPersist() };
  globals.__wayfinderCurations = new MemoryCurationStore();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Journey must stay offline'); }));
});
afterEach(() => {
  delete globals.__wayfinderServices; delete globals.__wayfinderCurations;
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe.each(['epithelioid-sarcoma', 'vascular-eds', 'igg4-related-disease'])('%s offline journey', slug => {
  it('extracts, confirms, researches and exposes evidence-backed curator tiers through the real routes', async () => {
    const response = await intake(request({ reportText: await readFile(`fixtures/reports/${slug}.md`, 'utf8') }));
    expect(response.status).toBe(201);
    sessionCookie = (response.headers.get('set-cookie') ?? '').split(';')[0]!;
    expect(sessionCookie).toMatch(/^wf_session=/);
    const { case: created } = await response.json();
    expect(created.status).toBe('draft');
    expect((await confirm(request({ fields: {} }), context(created.id))).status).toBe(200);
    const services = globals.__wayfinderServices!;
    const summary = await runResearch(created.id, { cases: services.cases, store: services.runs, persist: services.persist, ports: createFixturePorts(), agents: researchAgents, curations: globals.__wayfinderCurations });
    expect(summary.candidates).toBeGreaterThan(0);
    const listed = await shortlist(request({}), context(created.id));
    expect(listed.status).toBe(200);
    const result = await listed.json();
    expect(result.status).toBe('ready');
    const items = Object.values(result.groups).flat() as { evidence: { sourceUrl: string }[]; tier: string }[];
    expect(items).toHaveLength(summary.candidates);
    for (const item of items) {
      expect(['best', 'good', 'backup', 'exclude']).toContain(item.tier);
      expect(item.evidence.length).toBeGreaterThan(0);
      for (const evidence of item.evidence) expect(evidence.sourceUrl).toMatch(/^https?:\/\//);
    }
    expect(await globals.__wayfinderCurations!.load(created.id)).not.toBeNull();

    const store = new MemoryJourneyStore();
    store.caseId = created.id; store.record = { ...created, planId: 'SECRET-PLAN' };
    // Preserve the persisted shortlist's resource identity and evidence. A synthetic intake door
    // is added explicitly because recorded research does not promise allowlisted contact points.
    const persisted = await services.persist.getShortlist(created.id);
    store.choices = persisted.slice(0, 2).map((item, i) => ({ id: crypto.randomUUID(), caseId: created.id, targetId: item.targetId, targetKind: item.targetKind, evidence: [...item.evidence, i ? { claim: '+14155550123', claimType: 'contact_point.voice.nppes_location_phone', sourceUrl: 'https://journey.example/intake', sourceKind: 'nppes' as const } : { claim: 'intake@example.com', claimType: 'contact_point.email.new_patient_line', sourceUrl: 'https://journey.example/intake', sourceKind: 'exa' as const }] }));
    // Remove real contact doors in these synthetic outreach targets; never rewrite research output.
    for (const choice of store.choices) choice.evidence = choice.evidence.filter(e => !/contact|intake|referral|appointment|navigator/i.test(e.claimType + ' ' + e.claim) || e.sourceUrl === 'https://journey.example/intake');
    const guard = { allowlist: ['intake@example.com', '+14155550123'], mode: 'dev' as const };
    const mail = new MockMailer(guard); const caller = new MockCaller(guard);
    const service = new OutreachService(store, [mail, caller], { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: guard.allowlist.join(',') });
    const api = outreachHandlers(service);
    const selected = await api.select(request({ caseId: created.id, candidateIds: store.choices.map(c => c.id) }));
    expect(selected.status).toBe(200);
    const { contacts } = await selected.json();
    expect(contacts).toHaveLength(2);
    for (const contact of contacts) {
      expect((await api.consent(request({ sharedFields: ['diseaseName'] }), contact.id)).status).toBe(200);
      const draft = await (await api.draft(request({}), contact.id)).json();
      const unapproved = checkOutbound({ draft, caseRecord: store.record, consent: store.consents.get(contact.id)!, contacts: store.people, allowlist: guard.allowlist, now: new Date().toISOString(), mode: 'dev' });
      expect(unapproved).toMatchObject({ ok: false, reasons: expect.arrayContaining(['not_approved']) });
      expect((await api.approve(request({ draftId: draft.id }), contact.id)).status).toBe(200);
    }
    expect(mail.sent).toHaveLength(1); expect(caller.calls).toHaveLength(1);
    expect(hasDisclosure(mail.sent[0].body)).toBe(true);
    expect(caller.calls[0].script.startsWith(AI_DISCLOSURE_VOICE)).toBe(true);
    for (const body of [mail.sent[0].body, caller.calls[0].script]) {
      expect(body).toContain(created.diseaseName); expect(body).not.toContain('SECRET-PLAN');
      for (const field of ['insurer', 'homeCity', 'stageSummary'] as const) if (created[field]) expect(body).not.toContain(created[field]);
    }
    expect(mail.sent[0].to).toBe('intake@example.com'); expect(caller.calls[0].to).toBe('+14155550123');

    const fixture = JSON.parse(await readFile('fixtures/inbox/01-needs-referral-basic.json', 'utf8'));
    const owner = contacts.find((c: { channel: string }) => c.channel === 'email');
    const tasks = new MemoryTaskStore();
    const inboundMessages = new MemoryInboundMessageStore();
    const events: unknown[] = [];
    const inbound: InboundDeps = { secret, lookupThread: async id => id === mail.sent[0].ref.threadId ? { contactId: owner.id, caseId: created.id } : undefined, lookupCall: async () => undefined,
      storeCallEvent: async () => {}, sendEvents: async event => { events.push(event); }, ingestLedger: memoryIngestLedger(),
      storeInboundMessage: async message => { inboundMessages.add({ id: message.providerMessageId, contactId: message.contactId, body: message.body }); return 'stored'; },
      ingestInbound: async event => ingestInbound({ ...event, receivedAt: event.receivedAt ?? new Date().toISOString() }, {
        tasks, classifier: new FixtureClassifier(), lookupThread: async () => owner.id,
        loadContext: async () => ({ contactId: owner.id, caseId: created.id, resourceName: 'Synthetic intake', consent: { sharedFields: ['diseaseName'] }, caseRecord: created, currentPhysician: { name: 'Synthetic physician', email: 'referral@example.com' } }),
      }),
    };
    const body = (thread: string) => JSON.stringify({ event_type: 'message.received', message: { inbox_id: 'mock-inbox', thread_id: thread, message_id: 'reply-1', from: 'intake@example.com', text: fixture.event.body, timestamp: new Date().toISOString() } });
    expect((await handleAgentMailWebhook(signed(body('unknown')), inbound)).status).toBe(404);
    expect(tasks.rows.size).toBe(0); expect(events).toHaveLength(0);
    expect((await handleAgentMailWebhook(signed(body(mail.sent[0].ref.threadId!)), inbound)).status).toBe(200);
    expect(events).toHaveLength(1); expect(tasks.rows.size).toBe(1);
    const task = [...tasks.rows.values()][0]; expect(task.status).toBe('open');
    const approved = await inboxHandlers({ tasks, outreach: store, inbound: inboundMessages }).approve(request({}), task.id);
    expect(approved.status).toBe(200);
    const next = await approved.json();
    expect(next.draft.approvedAt).toBeNull(); expect(next.draft.sentAt).toBeNull();
    expect((await tasks.task(task.id))!.status).toBe('done');
    expect(mail.sent).toHaveLength(1); // Task approval alone cannot send the next draft.

    // A silent contact follows a different branch from the replied contact above.
    const silent = contacts.find((c: { channel: string }) => c.channel === 'voice');
    const first = new Date();
    const started = transition(initialContext(), { type: 'APPROVED_SENT' }, first);
    if (!started.ok) throw new Error(started.error);
    let state = started.context;
    const draftedAt: string[] = [];
    const followUps = new InMemoryContactContextStore();
    const emitted: unknown[] = [];
    const step: WorkflowStep = {
      run: async (_id, work) => work(),
      waitForEvent: async (_id, options) => { vi.setSystemTime(new Date(options.timeout)); return null; },
      sendEvent: async (_id, event) => { emitted.push(event); },
    };
    const outcome = await createConnectionWorkflow({ loadMessageApproval: async () => first.toISOString(), clock: { now: () => new Date(), scale: 1 }, tz: 'UTC',
      loadContext: async () => state, saveContext: async (_id, nextState) => { state = nextState; },
      send: async () => { throw new Error('Already sent; follow-ups require approval'); },
      draftFollowUp: async input => { draftedAt.push(new Date().toISOString()); return followUps.createFollowUpDraft(input); },
    }).handler({ event: { name: 'contact/approved', data: { contactId: silent.id, caseId: created.id, messageId: 'initial', approvedAt: first.toISOString() } }, step });
    expect(outcome).toEqual({ outcome: 'stalled' });
    expect(draftedAt).toEqual(['2026-03-05T14:00:00.000Z', '2026-03-11T14:00:00.000Z']);
    expect(new Date().toISOString()).toBe('2026-03-16T14:00:00.000Z');
    expect(state.state).toBe('stalled'); expect(emitted).toHaveLength(3);
    expect(followUps.drafts.map(d => d.followUpNumber)).toEqual([1, 2]);
    expect(caller.calls).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('rejects forged channel payloads, a sixth contact, non-allowlisted recipients and medical advice', async () => {
  const store = new MemoryJourneyStore();
  const mail = new MockMailer({ allowlist: ['intake@example.com'] });
  await expect(mail.send({ channel: 'email', address: 'intake@example.com', approvedAt: new Date().toISOString(), body: 'forged' } as GatedDraft)).rejects.toThrow(/checkOutbound/);
  const service = new OutreachService(store, [mail], { OUTBOUND_ALLOWLIST: 'intake@example.com' });
  const five = Array.from({ length: 5 }, () => store.candidate());
  await service.select(store.caseId, five.map(c => c.id));
  await expect(service.select(store.caseId, [store.candidate().id])).rejects.toMatchObject({ reasons: ['contact_cap'] });
  const contact = store.people[0]; await service.consent(contact.id, ['diseaseName']);
  const draft = await service.draft(contact.id);
  contact.address = 'intake@outside.example';
  store.drafts.set(draft.id, { ...store.drafts.get(draft.id)!, address: contact.address });
  await expect(service.approve(contact.id, draft.id)).rejects.toMatchObject({ reasons: expect.arrayContaining(['not_allowlisted']) });
  contact.address = 'intake@example.com';
  store.drafts.set(draft.id, { ...store.drafts.get(draft.id)!, address: contact.address });
  store.drafts.set(draft.id, { ...store.drafts.get(draft.id)!, body: draft.body + ' We recommend chemotherapy.' });
  await expect(service.approve(contact.id, draft.id)).rejects.toMatchObject({ reasons: expect.arrayContaining(['medical_advice']) });
  expect(mail.sent).toHaveLength(0); expect(store.drafts.get(draft.id)!.approvedAt).toBeFalsy();
});

it.todo('appointment booking: no application route/service currently accepts a confirmed appointment; BOOKED exists only as a state-machine event');
it.todo('follow-up classification persistence: PostgresContactContextStore creates message bodies/classifications via SQL; InMemoryContactContextStore records draft IDs and ordinals only');
