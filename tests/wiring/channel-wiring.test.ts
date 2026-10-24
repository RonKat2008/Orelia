import { describe, expect, it, vi } from 'vitest';
import { AgentCallChannel } from '../../lib/channels/agentcall';
import { AgentMailChannel } from '../../lib/channels/agentmail';
import { MockCaller } from '../../lib/channels/mock-caller';
import { MockMailer } from '../../lib/channels/mock-mailer';
import {
  createFollowUpSender, DuplicateSendError, FollowUpRefusedError, guardFromEnv, selectChannels, WiredOutreachService,
  type FollowUpDraftReader, type FollowUpMessage, type FollowUpStore,
} from '../../lib/outreach/channel-wiring';
import { OutreachError, type Candidate, type Consent, type Contact, type Draft, type OutreachStore, type ProviderRef } from '../../lib/outreach/types';
import { withDisclosure } from '../../lib/safety/disclosure';
import { recordingSendEvents } from '../../lib/workflows/events';

const id = () => crypto.randomUUID();
const ADDR = 'intake@example.com';
const FIRST_SENT = '2026-10-26T12:00:00.000Z'; // Monday
const DAY3_PLUS = new Date('2026-10-29T13:00:00.000Z'); // Thursday, past business day 3
type Row = Contact & { firstSentAt?: string | null };

class MemoryStore implements OutreachStore, FollowUpDraftReader {
  caseId = id();
  record = { diseaseName: 'epithelioid sarcoma', insurer: 'Fictional Plan' };
  people: Row[] = [];
  consents = new Map<string, Consent>();
  drafts = new Map<string, Draft>();
  followUps = new Map<string, FollowUpMessage>();
  released: string[] = [];
  async getCase(key: string) { return key === this.caseId ? this.record : undefined; }
  async candidates(): Promise<Candidate[]> { return []; }
  async contacts(caseId: string) { return this.people.filter(c => c.caseId === caseId); }
  async contact(key: string) { return this.people.find(c => c.id === key); }
  async select(): Promise<Contact[]> { return []; }
  async consent(key: string) { return this.consents.get(key); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) { this.drafts.set(d.id, structuredClone(d)); }
  async draft(key: string) { const d = this.drafts.get(key); return d ? structuredClone(d) : undefined; }
  async reserve(draft: Draft, approvedAt: string) {
    const row = this.drafts.get(draft.id)!;
    if (row.approvedAt) return false;
    row.approvedAt = approvedAt; return true;
  }
  async delivered(d: Draft, _ref: ProviderRef, sentAt: string) {
    this.drafts.get(d.id)!.sentAt = sentAt;
    this.people = this.people.map(c => c.id === d.contactId ? { ...c, state: 'sent' } : c);
  }
  // follow-up side
  async get(draftId: string, contactId: string) {
    const f = this.followUps.get(draftId);
    if (f && f.contactId === contactId) return f;
    const d = this.drafts.get(draftId);
    return d && d.contactId === contactId ? { messageId: d.id, contactId, caseId: d.caseId, classification: null, approvedAt: d.approvedAt, sentAt: d.sentAt } : undefined;
  }
  async markFirstSent(contactId: string, sentAt: string) { this.people = this.people.map(c => c.id === contactId && !c.firstSentAt ? { ...c, firstSentAt: sentAt } : c); }
  async getMessage(messageId: string) { return this.followUps.get(messageId); }
  async reserve2(): Promise<void> {}
  releaseCalls = 0;
}
// FollowUpStore.reserve/release/delivered live on a separate object because OutreachStore.reserve has another shape.
function followUpStore(store: MemoryStore): FollowUpStore {
  return {
    getMessage: m => store.getMessage(m),
    async reserve(messageId, contactId, at) {
      const m = store.followUps.get(messageId);
      if (!m || m.contactId !== contactId || m.approvedAt || m.sentAt) return false;
      m.approvedAt = at; return true;
    },
    async release(messageId) { store.followUps.get(messageId)!.approvedAt = null; store.released.push(messageId); },
    async delivered(messageId, _contactId, _ref, sentAt) {
      store.followUps.get(messageId)!.sentAt = sentAt;
    },
  };
}

function setup(envOver: Record<string, string | undefined> = {}, now = new Date('2026-10-23T12:00:00Z')) {
  const env = { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: ADDR, ...envOver };
  const store = new MemoryStore();
  const guard = guardFromEnv(env);
  const mailer = new MockMailer(guard); const caller = new MockCaller(guard);
  const ev = recordingSendEvents();
  const service = new WiredOutreachService(store, [mailer, caller], ev.send, env, () => now, store);
  return { env, store, mailer, caller, ev, service, now };
}
function addContact(store: MemoryStore, over: Partial<Row> = {}, consent = true) {
  const contact: Row = { id: id(), caseId: store.caseId, targetId: id(), targetKind: 'expert', channel: 'email', address: ADDR, state: 'drafted', ...over };
  store.people.push(contact);
  if (consent) store.consents.set(contact.id, { contactId: contact.id, sharedFields: ['diseaseName'], approvedAt: '2026-10-23T11:00:00Z' });
  return contact;
}
async function draftFor(ctx: ReturnType<typeof setup>, contact: Contact) { return ctx.service.draft(contact.id); }

describe('selectChannels', () => {
  const keys = { AGENTMAIL_API_KEY: 'am_test', AGENTCALL_API_KEY: 'ac_test', AGENTCALL_FROM_NUMBER_ID: 'num_test' };
  it('uses mocks without keys', () => {
    const { channels, providers } = selectChannels({ OUTBOUND_ALLOWLIST: ADDR });
    expect(providers).toEqual({ email: 'mock-mailer', voice: 'mock-caller' });
    expect(channels[0]).toBeInstanceOf(MockMailer); expect(channels[1]).toBeInstanceOf(MockCaller);
  });
  it('uses mocks offline even with keys', () => {
    for (const flag of ['1', 'true']) expect(selectChannels({ ...keys, WAYFINDER_OFFLINE: flag }).providers).toEqual({ email: 'mock-mailer', voice: 'mock-caller' });
  });
  it('uses real classes with keys (construct only, no send)', () => {
    const { channels, providers } = selectChannels(keys);
    expect(providers).toEqual({ email: 'agentmail', voice: 'agentcall' });
    expect(channels[0]).toBeInstanceOf(AgentMailChannel); expect(channels[1]).toBeInstanceOf(AgentCallChannel);
  });
  it('voice needs both the key and the number id', () => {
    expect(selectChannels({ AGENTMAIL_API_KEY: 'x', AGENTCALL_API_KEY: 'y' }).providers).toEqual({ email: 'agentmail', voice: 'mock-caller' });
    expect(selectChannels({ AGENTCALL_FROM_NUMBER_ID: 'n' }).providers.voice).toBe('mock-caller');
  });
  it('guardFromEnv maps allowlist, mode and allow-real', () => {
    expect(guardFromEnv({ OUTBOUND_ALLOWLIST: 'A@Example.com, junk', NODE_ENV: 'production', OUTBOUND_ALLOW_REAL: 'true' })).toEqual({ allowlist: ['a@example.com'], mode: 'prod', outboundAllowReal: 'true' });
    expect(guardFromEnv({}).mode).toBe('dev');
  });
});

describe('WiredOutreachService.approve', () => {
  it('sends exactly one email to the allowlisted address, stamps first send and emits contact-approved once', async () => {
    const ctx = setup(); const contact = addContact(ctx.store);
    const draft = await draftFor(ctx, contact);
    const result = await ctx.service.approve(contact.id, draft.id);
    expect(ctx.mailer.sent).toHaveLength(1); expect(ctx.mailer.sent[0].to).toBe(ADDR);
    expect(ctx.ev.events).toHaveLength(1);
    expect(ctx.ev.events[0].id).toBe(`contact-approved-${draft.id}`);
    expect(ctx.ev.events[0].data).toMatchObject({ contactId: contact.id, caseId: ctx.store.caseId, messageId: draft.id });
    expect(ctx.store.people[0].firstSentAt).toBe((result as { sentAt: string }).sentAt);
    expect('workflow' in result).toBe(false);
  });
  it('refuses a non-allowlisted address end to end: no send, no event', async () => {
    const ctx = setup({ OUTBOUND_ALLOWLIST: 'other@example.com' }); const contact = addContact(ctx.store);
    const draft = await draftFor(ctx, contact);
    await expect(ctx.service.approve(contact.id, draft.id)).rejects.toMatchObject({ status: 422, reasons: expect.arrayContaining(['not_allowlisted']) });
    expect(ctx.mailer.sent).toHaveLength(0); expect(ctx.ev.events).toHaveLength(0);
  });
  it('refuses without consent', async () => {
    const ctx = setup(); const contact = addContact(ctx.store);
    const draft = await draftFor(ctx, contact);
    ctx.store.consents.delete(contact.id);
    await expect(ctx.service.approve(contact.id, draft.id)).rejects.toMatchObject({ status: 422, reasons: ['consent_required'] });
    expect(ctx.mailer.sent).toHaveLength(0); expect(ctx.ev.events).toHaveLength(0);
  });
  it('an already approved draft is 409 with no send and no event', async () => {
    const ctx = setup(); const contact = addContact(ctx.store);
    const draft = await draftFor(ctx, contact);
    await ctx.service.approve(contact.id, draft.id);
    await expect(ctx.service.approve(contact.id, draft.id)).rejects.toMatchObject({ status: 409 });
    expect(ctx.mailer.sent).toHaveLength(1); expect(ctx.ev.events).toHaveLength(1);
  });
  it('event failure after a successful send returns workflow pending instead of throwing', async () => {
    const ctx = setup(); const contact = addContact(ctx.store);
    const draft = await draftFor(ctx, contact);
    const failing = new WiredOutreachService(ctx.store, [ctx.mailer], async () => { throw new Error('inngest down'); }, ctx.env, () => ctx.now, ctx.store);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await failing.approve(contact.id, draft.id);
    expect(result).toMatchObject({ workflow: 'pending', draftId: draft.id });
    expect(ctx.mailer.sent).toHaveLength(1);
  });
  it('follow-up approve sends nothing and emits follow-up-approved', async () => {
    const ctx = setup(); const contact = addContact(ctx.store, { state: 'sent', firstSentAt: FIRST_SENT });
    const messageId = id();
    ctx.store.followUps.set(messageId, { messageId, contactId: contact.id, caseId: ctx.store.caseId, classification: 'follow_up_1', approvedAt: null, sentAt: null, direction: 'outbound', channel: 'email', body: 'x' });
    const result = await ctx.service.approve(contact.id, messageId);
    expect(result).toMatchObject({ draftId: messageId, queued: true });
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(ctx.ev.events).toHaveLength(1);
    expect(ctx.ev.events[0].id).toBe(`follow-up-approved-${messageId}`);
    ctx.store.followUps.get(messageId)!.approvedAt = '2026-10-29T00:00:00Z';
    await expect(ctx.service.approve(contact.id, messageId)).rejects.toBeInstanceOf(OutreachError);
    expect(ctx.ev.events).toHaveLength(1);
  });
});

describe('createFollowUpSender', () => {
  function senderCtx(envOver: Record<string, string | undefined> = {}, now = DAY3_PLUS, contactOver: Partial<Row> = {}, classification = 'follow_up_1') {
    const ctx = setup(envOver, now);
    const contact = addContact(ctx.store, { state: 'sent', firstSentAt: FIRST_SENT, followUpsSent: 0, ...contactOver });
    const messageId = id();
    ctx.store.followUps.set(messageId, {
      messageId, contactId: contact.id, caseId: ctx.store.caseId, classification, approvedAt: null, sentAt: null,
      direction: 'outbound', channel: 'email', subject: 'Following up', body: withDisclosure('Following up on my earlier note.'),
    });
    const send = createFollowUpSender({ env: ctx.env, store: ctx.store, channels: [ctx.mailer, ctx.caller], clock: () => now, db: followUpStore(ctx.store) });
    return { ...ctx, contact, messageId, send, input: { contactId: contact.id, caseId: ctx.store.caseId, messageId, kind: 'follow_up' as const } };
  }
  it('refuses initial sends', async () => {
    const c = senderCtx();
    await expect(c.send({ ...c.input, kind: 'initial' })).rejects.toThrow(/approve route/);
    expect(c.mailer.sent).toHaveLength(0);
  });
  it('sends a due follow-up once; a second call is a DuplicateSendError', async () => {
    const c = senderCtx();
    const out = await c.send(c.input);
    expect(out.providerRef).toMatch(/^mock-message-/);
    expect(c.mailer.sent).toHaveLength(1);
    // The sender leaves follow_ups_sent to the workflow state machine, so it is not double counted.
    expect(c.store.people.find(p => p.id === c.contact.id)!.followUpsSent).toBe(0);
    await expect(c.send(c.input)).rejects.toBeInstanceOf(DuplicateSendError);
    expect(c.mailer.sent).toHaveLength(1);
  });
  it('refuses and releases the reservation when cadence is not met', async () => {
    const c = senderCtx({}, new Date('2026-10-27T12:00:00Z'));
    await expect(c.send(c.input)).rejects.toMatchObject({ reasons: ['follow_up_cadence'] });
    expect(c.mailer.sent).toHaveLength(0);
    expect(c.store.followUps.get(c.messageId)!.approvedAt).toBeNull();
    expect(c.store.released).toEqual([c.messageId]);
  });
  it('refuses a follow-up that does not belong to the contact or is out of order', async () => {
    const c = senderCtx();
    await expect(c.send({ ...c.input, contactId: id() })).rejects.toBeInstanceOf(FollowUpRefusedError);
    const second = senderCtx({}, DAY3_PLUS, {}, 'follow_up_2');
    await expect(second.send(second.input)).rejects.toMatchObject({ reasons: ['follow_up_out_of_order'] });
    expect(c.mailer.sent.length + second.mailer.sent.length).toBe(0);
  });
  it('refuses a non-allowlisted address through the gate', async () => {
    const c = senderCtx({ OUTBOUND_ALLOWLIST: 'other@example.com' });
    await expect(c.send(c.input)).rejects.toMatchObject({ reasons: expect.arrayContaining(['not_allowlisted']) });
    expect(c.mailer.sent).toHaveLength(0);
  });
  it('leaves approved_at set when the channel throws (no auto-retry)', async () => {
    const c = senderCtx();
    const boom = { kind: 'email' as const, send: async () => { throw new Error('ambiguous'); } };
    const send = createFollowUpSender({ env: c.env, store: c.store, channels: [boom], clock: () => DAY3_PLUS, db: followUpStore(c.store) });
    await expect(send(c.input)).rejects.toThrow('ambiguous');
    expect(c.store.followUps.get(c.messageId)!.approvedAt).toBeTruthy();
    await expect(send(c.input)).rejects.toBeInstanceOf(DuplicateSendError);
  });
  describe('simulated time', () => {
    const plus = (min: number) => new Date(new Date(FIRST_SENT).getTime() + min * 60_000);
    it('scale 1440 lets business day 3 through ~3 real minutes after first send in dev, not before', async () => {
      const early = senderCtx({ WAYFINDER_SIM_TIME_SCALE: '1440' }, plus(1));
      await expect(early.send(early.input)).rejects.toMatchObject({ reasons: ['follow_up_cadence'] });
      const due = senderCtx({ WAYFINDER_SIM_TIME_SCALE: '1440' }, plus(3.5));
      await due.send(due.input);
      expect(due.mailer.sent).toHaveLength(1);
    });
    it('is ignored in production mode', async () => {
      const prod = senderCtx({ WAYFINDER_SIM_TIME_SCALE: '1440', NODE_ENV: 'production' }, plus(3.5));
      await expect(prod.send(prod.input)).rejects.toMatchObject({ reasons: expect.arrayContaining(['follow_up_cadence']) });
      expect(prod.mailer.sent).toHaveLength(0);
    });
  });
});
