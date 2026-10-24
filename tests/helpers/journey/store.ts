import { activeContactCount } from '@/lib/safety/caps';
import { OutreachError, type Candidate, type Consent, type Contact, type Draft, type OutreachStore, type ProviderRef } from '@/lib/outreach/types';
const id = () => crypto.randomUUID();
export class MemoryJourneyStore implements OutreachStore {
  caseId = id();
  record = { diseaseName: 'epithelioid sarcoma', insurer: 'Fictional Plan', planId: 'SECRET-PLAN', homeState: 'CA' };
  choices: Candidate[] = [];
  people: Contact[] = [];
  consents = new Map<string, Consent>();
  drafts = new Map<string, Draft>();
  deliveries: ProviderRef[] = [];
  async getCase(key: string) { return key === this.caseId ? this.record : undefined; }
  async candidates(caseId: string, ids: string[]) { return this.choices.filter(c => c.caseId === caseId && ids.includes(c.id)); }
  async contacts(caseId: string) { return this.people.filter(c => c.caseId === caseId); }
  async contact(key: string) { return this.people.find(c => c.id === key); }
  async select(_caseId: string, contacts: Contact[], cap: number) { if (activeContactCount(this.people) + contacts.length > cap) throw new OutreachError(422, ['contact_cap']); this.people.push(...contacts); return contacts; }
  async consent(key: string) { return this.consents.get(key); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) { this.drafts.set(d.id, structuredClone(d)); }
  async draft(key: string) { const d = this.drafts.get(key); return d ? structuredClone(d) : undefined; }
  async reserve(draft: Draft, approvedAt: string) {
    const row = this.drafts.get(draft.id)!;
    if (row.approvedAt || [...this.drafts.values()].some(d => d.contactId === draft.contactId && d.approvedAt) || JSON.stringify(this.consents.get(draft.contactId)?.sharedFields) !== JSON.stringify(draft.sharedFields)) return false;
    row.approvedAt = approvedAt;
    return true;
  }
  async delivered(d: Draft, ref: ProviderRef, sentAt: string) { this.drafts.get(d.id)!.sentAt = sentAt; this.people = this.people.map(c => c.id === d.contactId ? { ...c, state: 'sent' } : c); this.deliveries.push(ref); }
  candidate(claim = 'intake@example.com', targetKind: Candidate['targetKind'] = 'expert') {
    // Stored evidence rows carry sourceKind (the Postgres store selects whole rows), which contact-point parsing requires.
    const candidate: Candidate = { id: id(), caseId: this.caseId, targetId: id(), targetKind, evidence: [{ claim, claimType: 'contact_point.email.new_patient_line', sourceUrl: 'https://example.com/intake', sourceKind: 'exa' } as Candidate['evidence'][number]] };
    this.choices.push(candidate); return candidate;
  }
}
