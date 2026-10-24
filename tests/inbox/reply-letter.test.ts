import { describe, expect, it } from 'vitest';
import { approveTask } from '../../lib/inbox/approve';
import { checkOutbound, type OutboundInput } from '../../lib/safety/outbound-gate';
import { withDisclosure } from '../../lib/safety/disclosure';
import { patientStatus } from '../../lib/patient-status/status';
import type { PatientCaseSnapshot, PatientContact } from '../../lib/patient-status/types';
import { isReplyClassification, type Contact, type Draft, type ProviderRef } from '../../lib/outreach/types';
import { OutreachService } from '../../lib/outreach/service';
import { MemoryStore, setup } from './helpers';

/** MemoryStore with the reply-letter methods, mirroring PostgresOutreachStore's SQL conditions. */
class ReplyStore extends MemoryStore {
  lastSentAt: string | null = '2026-10-20T12:00:00Z';
  lastReplyAt: string | null = '2026-10-22T12:00:00Z';
  async pendingReply(contact: Contact) {
    return [...this.drafts.values()].find(d => d.contactId === contact.id && isReplyClassification(d.classification) && !d.approvedAt && !d.sentAt);
  }
  async threadTimes() { return { lastSentAt: this.lastSentAt, lastReplyAt: this.lastReplyAt }; }
  async reserveReply(draft: Draft, approvedAt: string) {
    const row = this.drafts.get(draft.id);
    const contact = this.people.find(c => c.id === draft.contactId);
    const fresh = !!this.lastReplyAt && (!this.lastSentAt || this.lastReplyAt > this.lastSentAt);
    const otherApproved = [...this.drafts.values()].some(d => d.contactId === draft.contactId && d.id !== draft.id && d.approvedAt && !d.sentAt);
    if (!row || row.approvedAt || row.sentAt || !isReplyClassification(row.classification) || !fresh || otherApproved) return false;
    if (!contact || !['replied', 'task_open', 'records_sent'].includes(contact.state)) return false;
    if (JSON.stringify(this.consents.get(draft.contactId)?.sharedFields) !== JSON.stringify(draft.sharedFields)) return false;
    row.approvedAt = approvedAt;
    return true;
  }
  async deliveredReply(draft: Draft, ref: ProviderRef, sentAt: string) {
    this.drafts.get(draft.id)!.sentAt = sentAt;
    this.deliveries.push(ref);
    this.lastSentAt = sentAt;
    const i = this.people.findIndex(c => c.id === draft.contactId);
    this.people[i] = { ...this.people[i]!, state: 'records_sent' };
  }
}

/** The usual inbox fixture, on a contact that was written to and replied from its own address. */
function replied(kind: 'send_records' | 'send_slides' = 'send_records') {
  const t = setup({ NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'intake@example.com' });
  const store = Object.assign(new ReplyStore(), { caseId: t.outreach.caseId, record: t.outreach.record, people: t.outreach.people, consents: t.outreach.consents });
  const service = new OutreachService(store, [t.channel], { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'intake@example.com' }, () => new Date('2026-10-23T12:00:00Z'));
  const deps = { ...t.deps, outreach: store };
  const make = () => t.make({ class: kind }, { replyTo: { name: 'Pat Coordinator', email: 'Intake@Example.com' } });
  return { ...t, store, service, deps, make };
}

describe('records and slides letters to a contact who replied', () => {
  it('approving the task writes a reply letter that draft() offers instead of the sent message', async () => {
    const t = replied();
    const task = await t.make();
    const res = await approveTask(task.id, t.deps) as { contact: Contact; draft: Draft };
    expect(res.contact.id).toBe(t.original.id);
    expect(res.draft.classification).toBe('reply_records');
    expect(t.channel.sent).toHaveLength(0);
    const offered = await t.service.draft(t.original.id);
    expect(offered.id).toBe(res.draft.id);
    expect(offered.body).toBe(task.letter!.body);
  });

  it('sends once through the full gate, then the contact is records_sent', async () => {
    const t = replied('send_slides');
    const task = await t.make();
    const { draft } = await approveTask(task.id, t.deps) as { draft: Draft };
    expect(draft.classification).toBe('reply_slides');
    const result = await t.service.approve(t.original.id, draft.id);
    expect(result.sentAt).toBe('2026-10-23T12:00:00.000Z');
    expect(t.channel.sent).toHaveLength(1);
    expect(t.channel.sent[0]!.address).toBe('intake@example.com');
    expect(t.store.people.find(c => c.id === t.original.id)!.state).toBe('records_sent');
    await expect(t.service.approve(t.original.id, draft.id)).rejects.toMatchObject({ status: 409 });
    expect(t.channel.sent).toHaveLength(1);
  });

  it('is refused by the gate when their reply is not newer than our last send (no second answer)', async () => {
    const t = replied();
    const { draft } = await approveTask((await t.make()).id, t.deps) as { draft: Draft };
    t.store.lastSentAt = '2026-10-22T13:00:00Z';
    await expect(t.service.approve(t.original.id, draft.id)).rejects.toMatchObject({ status: 422, reasons: ['follow_up_cadence'] });
    expect(t.channel.sent).toHaveLength(0);
  });

  it('keeps every other gate check: a non-allowlisted address is refused', async () => {
    const t = replied();
    const { draft } = await approveTask((await t.make()).id, t.deps) as { draft: Draft };
    const strict = new OutreachService(t.store, [t.channel], { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'someone@else.test' }, () => new Date('2026-10-23T12:00:00Z'));
    await expect(strict.approve(t.original.id, draft.id)).rejects.toMatchObject({ status: 422, reasons: expect.arrayContaining(['not_allowlisted']) });
    expect(t.channel.sent).toHaveLength(0);
  });

  it('a store without reply support refuses rather than sending', async () => {
    const t = replied();
    const { draft } = await approveTask((await t.make()).id, { ...t.deps, outreach: t.outreach }) as { draft: Draft };
    await expect(new OutreachService(t.outreach, [t.channel], { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'intake@example.com' }).approve(t.original.id, draft.id))
      .rejects.toMatchObject({ status: 409, reasons: ['reply_unsupported'] });
    expect(t.channel.sent).toHaveLength(0);
  });
});

describe('the gate reply rule', () => {
  const base = (): OutboundInput => ({
    draft: { channel: 'email', address: 'intake@example.com', contactId: 'c1', body: withDisclosure('Here are the records you asked for.'), approvedAt: '2026-10-23T11:00:00Z', isReply: true },
    consent: { sharedFields: ['diseaseName'] },
    caseRecord: { diseaseName: 'rare disease' },
    contacts: [{ id: 'c1', address: 'intake@example.com', state: 'task_open', lastSentAt: '2026-10-22T10:00:00Z', lastReplyAt: '2026-10-22T12:00:00Z', followUpsSent: 0 }],
    allowlist: ['intake@example.com'], now: '2026-10-23T12:00:00Z', mode: 'demo',
  });
  it('passes an answer to a fresh reply', () => expect(checkOutbound(base()).ok).toBe(true));
  it.each([
    ['not flagged as a reply', { isReply: undefined }, {}],
    ['also flagged as a follow-up', { isFollowUp: true }, {}],
    ['no reply on the thread', {}, { lastReplyAt: null }],
    ['reply older than our last send', {}, { lastReplyAt: '2026-10-22T09:00:00Z' }],
    ['reply time in the future', {}, { lastReplyAt: '2026-10-24T12:00:00Z' }],
  ])('falls back to the follow-up cadence when %s', (_name, draft, contact) => {
    const input = base();
    input.draft = { ...input.draft, ...draft };
    input.contacts = [{ ...input.contacts[0]!, ...contact }];
    const result = checkOutbound(input);
    expect(result.ok ? [] : result.reasons).toEqual(['follow_up_cadence']);
  });
  it('still refuses an inactive contact, a missing disclosure and unshared details', () => {
    const input = base();
    input.contacts = [{ ...input.contacts[0]!, state: 'declined' }];
    input.caseRecord = { diseaseName: 'rare disease', homeCity: 'Springfield' };
    input.draft = { ...input.draft, body: 'Records attached. I live in Springfield.' };
    const result = checkOutbound(input);
    expect(result.ok ? [] : result.reasons).toEqual(expect.arrayContaining(['inactive_contact', 'missing_disclosure', 'unshared_field']));
  });
});

describe('patient status shows the reply letter as an approval card', () => {
  const contact = (over: Partial<PatientContact> = {}): PatientContact => ({
    id: 'c1', name: 'Cleveland Clinic', channel: 'email', state: 'task_open', consented: true, approved: true,
    nextFollowUpAt: null, lastActivityAt: null, ...over,
  });
  const snapshot = (contacts: PatientContact[]): PatientCaseSnapshot => ({
    caseId: 'k1', found: true, caseStatus: 'outreach', diseaseName: 'EDS', runs: [], expectedSources: 9,
    shortlist: { total: 3, suggested: 1 }, contacts, tasks: [], applications: [], plan: { status: 'approved' },
  });
  it.each(['records', 'slides'] as const)('%s: approve_message with the reply flag', (kind) => {
    const status = patientStatus(snapshot([contact({ pendingReply: kind })]), { now: new Date('2026-10-23T12:00:00Z') });
    expect(status.tone).toBe('you');
    expect(status.headline).toBe(`Cleveland Clinic asked for your ${kind}. Here's the reply we wrote. Take a look before it's sent.`);
    expect(status.nextAction).toMatchObject({ kind: 'approve_message', contactId: 'c1', reply: kind, name: 'Cleveland Clinic' });
  });
  it('without a pending reply the status is unchanged', () => {
    const status = patientStatus(snapshot([contact()]), { now: new Date('2026-10-23T12:00:00Z') });
    expect(status.nextAction).toBeUndefined();
    expect(status.headline).toBe("Cleveland Clinic replied. We're working out the next step.");
  });
  it('ignores a reply letter on a contact that cannot be answered (declined)', () => {
    const status = patientStatus(snapshot([contact({ state: 'declined', pendingReply: 'records' })]), { now: new Date('2026-10-23T12:00:00Z') });
    expect(status.nextAction?.kind).toBe('try_someone_else');
  });
});
