import { describe, expect, it } from 'vitest';
import { OutreachService } from '../../lib/outreach/service';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { activeContactCount } from '../../lib/safety/caps';
import type { EmailDestinationChoice } from '../../lib/outreach/demo-email-destination';
import { OutreachError, type Candidate, type Consent, type Contact, type Draft, type OutreachStore } from '../../lib/outreach/types';

const id = () => crypto.randomUUID();
const ENV = {
  NODE_ENV: 'test', WAYFINDER_DEMO_COORDINATORS: '1', AGENTMAIL_SENDER_INBOX_ID: 'sender@agentmail.to',
  OUTBOUND_ALLOWLIST: 'a@agentmail.to,me@gmail.com,sender@agentmail.to', DEMO_COORDINATOR_INBOXES: 'a@agentmail.to,me@gmail.com',
};

class MemoryStore implements OutreachStore {
  caseId = id();
  choice: EmailDestinationChoice | undefined;
  record = { diseaseName: 'epithelioid sarcoma', insurer: 'Fictional Plan', homeState: 'CA' };
  choices: Candidate[] = [];
  people: Contact[] = [];
  consents = new Map<string, Consent>();
  drafts = new Map<string, Draft>();
  async getCase(key: string) { return key === this.caseId ? this.record : undefined; }
  async candidates(caseId: string, ids: string[]) { return this.choices.filter(c => c.caseId === caseId && ids.includes(c.id)); }
  async contacts(caseId: string) { return this.people.filter(c => c.caseId === caseId); }
  async contact(key: string) { return this.people.find(c => c.id === key); }
  async select(_caseId: string, contacts: Contact[], cap: number) { if (activeContactCount(this.people) + contacts.length > cap) throw new OutreachError(422, ['contact_cap']); this.people.push(...contacts); return contacts; }
  async consent(key: string) { return this.consents.get(key); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) { this.drafts.set(d.id, structuredClone(d)); }
  async draft(key: string, contact: Contact) { const d = this.drafts.get(key); return d ? { ...structuredClone(d), address: contact.address } : undefined; }
  async reserve(draft: Draft, approvedAt: string) {
    const row = this.drafts.get(draft.id)!;
    const contact = this.people.find(c => c.id === draft.contactId)!;
    if (row.approvedAt || contact.address !== draft.address) return false;
    row.approvedAt = approvedAt;
    return true;
  }
  async delivered(d: Draft) { this.drafts.get(d.id)!.sentAt = 'x'; this.people = this.people.map(c => c.id === d.contactId ? { ...c, state: 'sent' } : c); }
  async demoEmailChoice() { return this.choice; }
  async rerouteContact(contact: Contact, address: string) {
    const row = this.people.find(c => c.id === contact.id);
    if (!row || row.state !== 'drafted') return false;
    row.address = address;
    return true;
  }
  candidate() {
    const c: Candidate = { id: id(), caseId: this.caseId, targetId: id(), targetKind: 'institution', evidence: [{ claim: 'intake@hospital.example.org', claimType: 'contact_point.email.new_patient_line', sourceUrl: 'https://hospital.example.org/intake', sourceKind: 'exa' }] as unknown as Candidate['evidence'] };
    this.choices.push(c); return c;
  }
}

async function setup(choice: EmailDestinationChoice | undefined, env: Record<string, string> = ENV) {
  const store = new MemoryStore();
  store.choice = choice;
  const mail = new MockChannel('email');
  const service = new OutreachService(store, [mail, new MockChannel('voice')], env, () => new Date('2026-10-23T12:00:00Z'));
  const cand = store.candidate();
  const { contacts, unavailable } = await service.select(store.caseId, [cand.id]);
  if (!contacts[0]) throw new Error(JSON.stringify(unavailable));
  const contact = contacts[0]!;
  await service.consent(contact.id, ['diseaseName']);
  const draft = await service.draft(contact.id);
  return { store, service, mail, contact, draft };
}

describe('demo email routing honours the per-case choice', () => {
  it('routes a new contact to the scripted inbox by default', async () => {
    const { contact } = await setup(undefined);
    expect(contact.address).toBe('a@agentmail.to');
  });
  it('routes a new contact to the personal inbox when chosen', async () => {
    const { contact } = await setup('personal');
    expect(contact.address).toBe('me@gmail.com');
  });
  it('re-resolves at send time: a draft made while scripted goes to the personal inbox if the choice changed before approval', async () => {
    const { store, service, mail, contact, draft } = await setup(undefined);
    expect(contact.address).toBe('a@agentmail.to');
    store.choice = 'personal';
    await service.approve(contact.id, draft.id);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.address).toBe('me@gmail.com');
  });
  it('re-resolves back to scripted too', async () => {
    const { store, service, mail, contact, draft } = await setup('personal');
    store.choice = 'scripted';
    await service.approve(contact.id, draft.id);
    expect(mail.sent[0]!.address).toBe('a@agentmail.to');
  });
  it('the outbound gate still refuses a chosen address that is not on the allowlist', async () => {
    const { store, mail, contact, draft } = await setup('personal');
    // me@gmail.com is configured as a coordinator but dropped from the allowlist afterwards.
    const env = { ...ENV, OUTBOUND_ALLOWLIST: 'a@agentmail.to,sender@agentmail.to' };
    const strict = new OutreachService(store, [mail], env, () => new Date('2026-10-23T12:00:00Z'));
    store.choice = 'personal';
    const err = await strict.approve(contact.id, draft.id).then(() => null, e => e as OutreachError);
    expect(err?.reasons).toContain('not_allowlisted');
    expect(mail.sent).toHaveLength(0);
  });
  it('leaves the contact alone when the chosen group is empty', async () => {
    const env = { ...ENV, OUTBOUND_ALLOWLIST: 'a@agentmail.to,sender@agentmail.to', DEMO_COORDINATOR_INBOXES: 'a@agentmail.to' };
    const { store, service, mail, contact, draft } = await setup(undefined, env);
    store.choice = 'personal';
    await service.approve(contact.id, draft.id);
    expect(mail.sent[0]!.address).toBe('a@agentmail.to');
  });
  it('does nothing outside demo mode', async () => {
    const env = { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'intake@hospital.example.org' };
    const { store, service, mail, contact, draft } = await setup('personal', env);
    expect(contact.address).toBe('intake@hospital.example.org');
    store.choice = 'personal';
    await service.approve(contact.id, draft.id);
    expect(mail.sent[0]!.address).toBe('intake@hospital.example.org');
  });
});
