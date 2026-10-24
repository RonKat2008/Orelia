/**
 * End-to-end follow-up flow without Inngest, wired the way production is (inline workflow events + Vercel Cron
 * sweep), over ONE in-memory message table shared by the outreach store, the follow-up store and the workflow deps.
 *
 * Regression for two live bugs:
 * 1. After the sweep drafted follow_up_1, OutreachService.draft() kept returning the already-sent first message,
 *    so the outbox never showed the follow-up for approval.
 * 2. Approving the follow-up returned 200 { queued: true } but nothing was approved or sent: the route never wrote
 *    messages.approved_at, so the inline workflow skipped it ("not approved in the database").
 */
import { describe, expect, it } from 'vitest';
import { ChannelError } from '../../lib/channels/types';
import { MockCaller } from '../../lib/channels/mock-caller';
import { MockMailer } from '../../lib/channels/mock-mailer';
import {
  createFollowUpSender, guardFromEnv, WiredOutreachService,
  type FollowUpDraftReader, type FollowUpMessage, type FollowUpStore,
} from '../../lib/outreach/channel-wiring';
import { outreachHandlers } from '../../lib/outreach/http';
import type { Candidate, Consent, Contact, Draft, OutreachStore, ProviderRef } from '../../lib/outreach/types';
import { followUpContent } from '../../lib/workflows/contact-store';
import type { ContactContext } from '../../lib/workflows/connection-machine';
import type { ConnectionDeps } from '../../lib/workflows/connection-workflow';
import { runFollowUpSweep, type FollowUpSweepStore } from '../../lib/workflows/follow-up-sweep';
import { inlineSendEvents } from '../../lib/workflows/inline-events';

const ADDR = 'intake@example.com';
const FIRST_SENT = new Date('2026-10-26T12:00:00.000Z'); // Monday
const DAY3 = new Date('2026-10-29T13:00:00.000Z'); // past business day 3
const DAY7 = new Date('2026-11-04T13:00:00.000Z'); // past business day 7
const DAY10 = new Date('2026-11-09T13:00:00.000Z'); // past business day 10 (stall)

type Person = Contact & { firstSentAt: Date | null; nextFollowUpAt: Date | null; lastActivityAt: Date | null };
type Msg = FollowUpMessage & { sharedFields: string[]; providerMessageId?: string };

/** One message table and one contacts table, seen through every interface the app uses. */
class World implements OutreachStore, FollowUpDraftReader {
  caseId = crypto.randomUUID();
  record = { diseaseName: 'epithelioid sarcoma' };
  people: Person[] = [];
  consents = new Map<string, Consent>();
  messages = new Map<string, Msg>();
  now = DAY3;

  async getCase(id: string) { return id === this.caseId ? this.record : undefined; }
  async candidates(): Promise<Candidate[]> { return []; }
  async contacts(caseId: string) { return this.people.filter(p => p.caseId === caseId).map(p => ({ ...p, lastSentAt: p.firstSentAt?.toISOString() ?? null })); }
  async contact(id: string) { const p = this.people.find(x => x.id === id); return p ? { ...p, firstSentAt: p.firstSentAt?.toISOString() ?? null } as unknown as Contact : undefined; }
  async select(): Promise<Contact[]> { return []; }
  async consent(id: string) { return this.consents.get(id); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) {
    this.messages.set(d.id, { messageId: d.id, contactId: d.contactId, caseId: d.caseId, classification: null, approvedAt: null, sentAt: null, direction: 'outbound', channel: d.channel, subject: d.subject, body: d.body, sharedFields: d.sharedFields });
  }
  private toDraft(m: Msg, c: Contact): Draft {
    return { id: m.messageId, contactId: m.contactId, caseId: m.caseId, channel: m.channel, address: c.address, subject: m.subject, body: m.body, sharedFields: m.sharedFields, approvedAt: m.approvedAt ?? null, sentAt: m.sentAt ?? null, classification: m.classification };
  }
  async sentDraft(c: Contact) {
    const sent = [...this.messages.values()].filter(m => m.contactId === c.id && m.sentAt).sort((a, b) => a.sentAt!.localeCompare(b.sentAt!));
    return sent.length ? this.toDraft(sent.at(-1)!, c) : undefined;
  }
  async pendingFollowUp(c: Contact) {
    const m = [...this.messages.values()].find(x => x.contactId === c.id && x.classification?.startsWith('follow_up_') && !x.approvedAt && !x.sentAt);
    return m ? this.toDraft(m, c) : undefined;
  }
  async draft(id: string, c: Contact) { const m = this.messages.get(id); return m && m.contactId === c.id ? this.toDraft(m, c) : undefined; }
  async reserve(d: Draft, at: string) { const m = this.messages.get(d.id)!; if (m.approvedAt) return false; m.approvedAt = at; return true; }
  async delivered(d: Draft, _ref: ProviderRef, at: string) { this.messages.get(d.id)!.sentAt = at; Object.assign(this.person(d.contactId), { state: 'sent' }); }
  // FollowUpDraftReader
  async get(draftId: string, contactId: string) { const m = this.messages.get(draftId); return m && m.contactId === contactId ? { ...m } : undefined; }
  async markFirstSent(contactId: string, sentAt: string) { const p = this.person(contactId); p.firstSentAt ??= new Date(sentAt); }
  async approveFollowUp(draftId: string, contactId: string, at: string) {
    const m = this.messages.get(draftId);
    if (!m || m.contactId !== contactId || !m.classification?.startsWith('follow_up_') || m.approvedAt || m.sentAt) return false;
    m.approvedAt = at; return true;
  }
  async withdrawFollowUpApproval(draftId: string, contactId: string) {
    const m = this.messages.get(draftId);
    if (m && m.contactId === contactId && !m.sentAt) m.approvedAt = null;
  }

  person(id: string) { const p = this.people.find(x => x.id === id); if (!p) throw new Error('no contact'); return p; }
  followUps(contactId: string) { return [...this.messages.values()].filter(m => m.contactId === contactId && m.classification?.startsWith('follow_up_')); }

  /** The follow-up store the sender uses: the send claim is sent_at; approved_at is the human authorization. */
  followUpStore(): FollowUpStore {
    return {
      getMessage: async id => { const m = this.messages.get(id); return m ? { ...m } : undefined; },
      reserve: async (id, contactId, at) => {
        const m = this.messages.get(id);
        if (!m || m.contactId !== contactId || !m.approvedAt || m.sentAt) return false;
        m.sentAt = at; return true;
      },
      release: async (id, contactId) => { const m = this.messages.get(id); if (m && m.contactId === contactId && !m.providerMessageId) m.sentAt = null; },
      delivered: async (id, contactId, ref, at) => { const m = this.messages.get(id)!; m.sentAt = at; m.providerMessageId = ref.messageId ?? 'x'; this.person(contactId).lastActivityAt = new Date(at); },
    };
  }

  /** Workflow deps over the same tables (mirrors PostgresContactContextStore). */
  deps(send: ConnectionDeps['send']): ConnectionDeps {
    return {
      clock: { now: () => this.now, scale: 1 },
      send,
      loadContext: async (id): Promise<ContactContext> => {
        const p = this.person(id);
        const outbound = [...this.messages.values()].filter(m => m.contactId === id);
        const sent = outbound.flatMap(m => m.sentAt ? [new Date(m.sentAt).getTime()] : []);
        return {
          state: p.state as ContactContext['state'], firstSentAt: p.firstSentAt, lastOutboundAt: sent.length ? new Date(Math.max(...sent)) : null,
          lastActivityAt: p.lastActivityAt, followUpsDue: this.followUps(id).length, followUpsSent: p.followUpsSent ?? 0, nextFollowUpAt: p.nextFollowUpAt,
        };
      },
      saveContext: async (id, ctx) => {
        Object.assign(this.person(id), { state: ctx.state, firstSentAt: ctx.firstSentAt, followUpsSent: ctx.followUpsSent, nextFollowUpAt: ctx.nextFollowUpAt, lastActivityAt: ctx.lastActivityAt });
      },
      draftFollowUp: async ({ contactId, followUpNumber }) => {
        const existing = this.followUps(contactId).find(m => m.classification === `follow_up_${followUpNumber}`);
        if (existing) return { messageId: existing.messageId };
        const messageId = crypto.randomUUID();
        const { subject, body } = followUpContent('email');
        this.messages.set(messageId, { messageId, contactId, caseId: this.caseId, classification: `follow_up_${followUpNumber}`, approvedAt: null, sentAt: null, direction: 'outbound', channel: 'email', subject, body, sharedFields: this.consents.get(contactId)?.sharedFields ?? [] });
        return { messageId };
      },
      loadMessageApproval: async id => this.messages.get(id)?.approvedAt ?? null,
    };
  }

  sweepStore(): FollowUpSweepStore {
    return {
      claimDue: async ({ now, leaseUntil }) => this.people
        .filter(p => p.state === 'sent' && p.nextFollowUpAt && p.nextFollowUpAt.getTime() <= now.getTime())
        .map(p => { const dueAt = p.nextFollowUpAt!; p.nextFollowUpAt = leaseUntil; return { contactId: p.id, caseId: p.caseId, dueAt }; }),
    };
  }
}

function setup(envOver: Record<string, string> = {}) {
  const env = { NODE_ENV: 'production', OUTBOUND_ALLOWLIST: ADDR, ...envOver };
  const world = new World();
  const guard = guardFromEnv(env);
  const mailer = new MockMailer(guard); const caller = new MockCaller(guard);
  const send = createFollowUpSender({ env, store: world, channels: [mailer, caller], clock: () => world.now, db: world.followUpStore() });
  const deps = world.deps(send);
  const service = new WiredOutreachService(world, [mailer, caller], inlineSendEvents(() => deps), env, () => world.now, world);
  const api = outreachHandlers(service);
  // A contact whose first message already went out on FIRST_SENT, scheduled for business day 3.
  const contactId = crypto.randomUUID(); const firstId = crypto.randomUUID();
  world.people.push({ id: contactId, caseId: world.caseId, targetId: crypto.randomUUID(), targetKind: 'institution', channel: 'email', address: ADDR, state: 'sent', followUpsSent: 0, firstSentAt: FIRST_SENT, nextFollowUpAt: new Date('2026-10-29T12:00:00.000Z'), lastActivityAt: FIRST_SENT });
  world.consents.set(contactId, { contactId, sharedFields: ['diseaseName'], approvedAt: '2026-10-26T11:00:00.000Z' });
  world.messages.set(firstId, { messageId: firstId, contactId, caseId: world.caseId, classification: null, approvedAt: FIRST_SENT.toISOString(), sentAt: FIRST_SENT.toISOString(), direction: 'outbound', channel: 'email', subject: 'Patient intake inquiry', body: 'first', sharedFields: ['diseaseName'], providerMessageId: 'pm-first' });
  const sweep = async (at: Date) => { world.now = at; return runFollowUpSweep({ store: world.sweepStore(), deps }); };
  const approve = async (draftId: string) => api.approve(new Request('http://x', { method: 'POST', body: JSON.stringify({ draftId }) }), contactId);
  return { env, world, mailer, service, api, contactId, firstId, sweep, approve };
}

describe('outbox: a pending follow-up draft is surfaced for approval', () => {
  it('before the sweep, draft() still returns the sent first message', async () => {
    const t = setup();
    const shown = await t.service.draft(t.contactId);
    expect(shown.id).toBe(t.firstId);
    expect(shown.sentAt).toBeTruthy();
  });

  it('after the sweep drafts follow_up_1, draft() returns it unapproved and unsent', async () => {
    const t = setup();
    expect(await t.sweep(DAY3)).toMatchObject({ claimed: 1, processed: 1, failed: 0 });
    const [fu1] = t.world.followUps(t.contactId);
    const shown = await t.service.draft(t.contactId);
    expect(shown.id).toBe(fu1.messageId);
    expect(shown).toMatchObject({ classification: 'follow_up_1', approvedAt: null, sentAt: null, address: ADDR });
    expect(t.mailer.sent).toHaveLength(0);
  });
});

describe('approving a follow-up without Inngest', () => {
  it('sets approved_at and sends it through the gate; the response carries sentAt, not queued', async () => {
    const t = setup();
    await t.sweep(DAY3);
    const [fu1] = t.world.followUps(t.contactId);
    const res = await t.approve(fu1.messageId);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.queued).toBeUndefined();
    expect(body.sentAt).toBeTruthy();
    expect(body.approvedAt).toBeTruthy();
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0].to).toBe(ADDR);
    expect(t.mailer.sent[0].body).toBe(fu1.body);
    const row = t.world.messages.get(fu1.messageId)!;
    expect(row.approvedAt).toBeTruthy();
    expect(row.sentAt).toBeTruthy();
    expect(t.world.person(t.contactId).followUpsSent).toBe(1);
    // Once sent, the outbox shows the sent follow-up rather than a new draft; a second approval is 409.
    expect((await t.service.draft(t.contactId)).id).toBe(fu1.messageId);
    expect((await t.approve(fu1.messageId)).status).toBe(409);
    expect(t.mailer.sent).toHaveLength(1);
  });

  it('a gate refusal is a 422 with reasons, and the draft stays unapproved and unsent', async () => {
    const t = setup({ OUTBOUND_ALLOWLIST: 'someone-else@example.com' });
    await t.sweep(DAY3);
    const [fu1] = t.world.followUps(t.contactId);
    const res = await t.approve(fu1.messageId);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain('not_allowlisted');
    expect(t.mailer.sent).toHaveLength(0);
    expect(t.world.messages.get(fu1.messageId)).toMatchObject({ approvedAt: null, sentAt: null });
    expect((await t.service.draft(t.contactId)).id).toBe(fu1.messageId);
  });

  it('a provider 4xx on a follow-up leaves it unapproved and retryable; an ambiguous failure stays claimed', async () => {
    const t = setup();
    await t.sweep(DAY3);
    const [fu1] = t.world.followUps(t.contactId);
    const real = t.mailer.send.bind(t.mailer);
    t.mailer.send = async () => { throw new ChannelError('agentmail', 'forbidden', 403); };
    expect((await t.approve(fu1.messageId)).status).toBe(502);
    expect(t.world.messages.get(fu1.messageId)).toMatchObject({ approvedAt: null, sentAt: null });
    expect((await t.service.draft(t.contactId)).id).toBe(fu1.messageId);
    t.mailer.send = async () => { throw new ChannelError('agentmail', 'boom', 500, true); };
    expect((await t.approve(fu1.messageId)).status).toBe(502);
    expect(t.world.messages.get(fu1.messageId)!.sentAt).toBeTruthy(); // ambiguous: never auto-retried
    t.mailer.send = real;
    expect((await t.approve(fu1.messageId)).status).toBe(409);
    expect(t.mailer.sent).toHaveLength(0);
  });

  it('is not reported as queued when the contact can no longer receive it (replied): 409, nothing approved', async () => {
    const t = setup();
    await t.sweep(DAY3);
    const [fu1] = t.world.followUps(t.contactId);
    Object.assign(t.world.person(t.contactId), { state: 'replied' });
    const res = await t.approve(fu1.messageId);
    expect(res.status).toBe(409);
    expect(t.mailer.sent).toHaveLength(0);
    expect(t.world.messages.get(fu1.messageId)!.approvedAt).toBeNull();
  });

  it('day 7: the second follow-up is drafted, shown, approved and sent; after the final deadline the contact stalls', async () => {
    const t = setup();
    await t.sweep(DAY3);
    const [fu1] = t.world.followUps(t.contactId);
    expect((await t.approve(fu1.messageId)).status).toBe(200);

    expect(await t.sweep(DAY7)).toMatchObject({ claimed: 1, processed: 1 });
    const fu2 = t.world.followUps(t.contactId).find(m => m.classification === 'follow_up_2')!;
    const shown = await t.service.draft(t.contactId);
    expect(shown).toMatchObject({ id: fu2.messageId, classification: 'follow_up_2', approvedAt: null });
    const res = await t.approve(fu2.messageId);
    expect(res.status).toBe(200);
    expect((await res.json()).sentAt).toBeTruthy();
    expect(t.mailer.sent).toHaveLength(2);
    expect(t.world.person(t.contactId).followUpsSent).toBe(2);
    expect(t.world.person(t.contactId).state).toBe('sent');

    expect(await t.sweep(DAY10)).toMatchObject({ claimed: 1, stalled: 1 });
    expect(t.world.person(t.contactId).state).toBe('stalled');
    expect(t.world.person(t.contactId).nextFollowUpAt).toBeNull();
    expect(t.mailer.sent).toHaveLength(2);
  });

  it('day 7 with no approval of the second follow-up still stalls after the final deadline, sending nothing more', async () => {
    const t = setup();
    await t.sweep(DAY3);
    const [fu1] = t.world.followUps(t.contactId);
    await t.approve(fu1.messageId);
    await t.sweep(DAY7);
    await t.sweep(DAY10);
    expect(t.world.person(t.contactId).state).toBe('stalled');
    expect(t.mailer.sent).toHaveLength(1);
    // A stalled contact no longer offers the unapproved follow-up for approval.
    expect((await t.service.draft(t.contactId)).id).toBe(fu1.messageId);
  });
});
