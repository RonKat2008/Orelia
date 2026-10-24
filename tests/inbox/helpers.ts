import { draftTasks, type DraftContext } from '../../lib/inbox/drafts';
import { MemoryInboundMessageStore } from '../../lib/inbox/inbound-store';
import { MemoryTaskStore } from '../../lib/inbox/task-store';
import type { InboxClassification } from '../../lib/inbox/schema';
import { OutreachService } from '../../lib/outreach/service';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { activeContactCount } from '../../lib/safety/caps';
import { OutreachError, type Candidate, type Consent, type Contact, type Draft, type OutreachStore, type ProviderRef } from '../../lib/outreach/types';

export const id = () => crypto.randomUUID();
export class MemoryStore implements OutreachStore {
  caseId = id();
  record = { diseaseName: 'epithelioid sarcoma', insurer: 'Fictional Plan', planId: 'SECRET-PLAN', homeState: 'CA' };
  people: Contact[] = [];
  consents = new Map<string, Consent>();
  drafts = new Map<string, Draft>();
  deliveries: ProviderRef[] = [];
  async getCase(key: string) { return key === this.caseId ? this.record : undefined; }
  async candidates(): Promise<Candidate[]> { return []; }
  async contacts(caseId: string) { return this.people.filter(c => c.caseId === caseId); }
  async contact(key: string) { return this.people.find(c => c.id === key); }
  async select(_caseId: string, contacts: Contact[], cap: number) { if (activeContactCount(this.people) + contacts.length > cap) throw new OutreachError(422, ['contact_cap']); this.people.push(...contacts); return contacts; }
  async consent(key: string) { return this.consents.get(key); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) { this.drafts.set(d.id, structuredClone(d)); }
  async draft(key: string) { const d = this.drafts.get(key); return d ? structuredClone(d) : undefined; }
  async reserve(draft: Draft, approvedAt: string) {
    const row = this.drafts.get(draft.id)!;
    if (row.approvedAt || JSON.stringify(this.consents.get(draft.contactId)?.sharedFields) !== JSON.stringify(draft.sharedFields)) return false;
    row.approvedAt = approvedAt; return true;
  }
  async delivered(d: Draft, ref: ProviderRef, sentAt: string) { this.drafts.get(d.id)!.sentAt = sentAt; this.deliveries.push(ref); }
}

export const REPLY = 'Thanks. Please contact our intake team at New@Example.com for scheduling.';
export function setup(env: Record<string, string> = { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'dr@example.com,records@example.com,lab@example.com' }) {
  const outreach = new MemoryStore();
  const tasks = new MemoryTaskStore();
  const inbound = new MemoryInboundMessageStore();
  const original: Contact = { id: id(), caseId: outreach.caseId, targetId: id(), targetKind: 'institution', channel: 'email', address: 'intake@example.com', state: 'replied' };
  outreach.people.push(original);
  outreach.consents.set(original.id, { contactId: original.id, sharedFields: ['diseaseName'], approvedAt: '2026-10-23T00:00:00Z' });
  const msg = inbound.add({ id: id(), contactId: original.id, body: REPLY });
  const channel = new MockChannel('email');
  const service = new OutreachService(outreach, [channel], env, () => new Date('2026-10-23T12:00:00Z'));
  const ctx: DraftContext = {
    contactId: original.id, messageId: msg.id, caseId: outreach.caseId, resourceName: 'Example Cancer Center', consent: { sharedFields: ['diseaseName'] }, caseRecord: outreach.record as never,
    currentPhysician: { name: 'Dr. Lee', email: 'dr@example.com' }, pathologyLab: { name: 'Lab', email: 'lab@example.com' },
  };
  const make = async (c: Partial<InboxClassification> & Pick<InboxClassification, 'class'>, over: Partial<DraftContext> = {}) =>
    (await tasks.saveTasks(draftTasks({ confidence: 0.9, rationale: 'r', ...c }, { ...ctx, ...over })))[0];
  return { outreach, tasks, inbound, msg, original, channel, service, make, deps: { tasks, outreach, inbound, clock: () => new Date('2026-10-23T12:00:00Z') } };
}

