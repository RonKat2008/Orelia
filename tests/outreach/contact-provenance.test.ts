import { describe, expect, it } from 'vitest';
import { OutreachService } from '../../lib/outreach/service';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { activeContactCount } from '../../lib/safety/caps';
import { contactPointEvidence, parseContactPoints } from '../../lib/contact-finder/contact-points';
import { OutreachError, type Candidate, type Contact, type OutreachStore } from '../../lib/outreach/types';

const id = () => crypto.randomUUID();
/** Stored evidence rows carry sourceKind (the Postgres store selects whole rows). */
type Ev = Candidate['evidence'][number] & { sourceKind?: string };

class Store implements Partial<OutreachStore> {
  caseId = id();
  choices: Candidate[] = [];
  people: Contact[] = [];
  async getCase(key: string) { return key === this.caseId ? { diseaseName: 'epithelioid sarcoma' } : undefined; }
  async candidates(caseId: string, ids: string[]) { return this.choices.filter(c => c.caseId === caseId && ids.includes(c.id)); }
  async contacts(caseId: string) { return this.people.filter(c => c.caseId === caseId); }
  async select(_caseId: string, contacts: Contact[], cap: number) {
    if (activeContactCount(this.people) + contacts.length > cap) throw new OutreachError(422, ['contact_cap']);
    this.people.push(...contacts); return contacts;
  }
  add(evidence: Ev[]) {
    const c: Candidate = { id: id(), caseId: this.caseId, targetId: id(), targetKind: 'institution', evidence };
    this.choices.push(c); return c;
  }
}

function setup() {
  const store = new Store();
  const service = new OutreachService(store as unknown as OutreachStore, [new MockChannel('email'), new MockChannel('voice')], { NODE_ENV: 'test' });
  return { store, service };
}

const PAGE = 'https://example.org/sarcoma-program';

describe('outreach contacts come only from tool-sourced contact points (H1)', () => {
  it('never uses a model-invented email or phone written into evidence claim text', async () => {
    const { store, service } = setup();
    const c = store.add([
      { claimType: 'intake_contact', claim: 'New patient intake: intake@example.org, call +1 617 555 0100', sourceUrl: PAGE, sourceKind: 'exa' },
      { claimType: 'disease_program', claim: 'Referrals: referrals@example.org', sourceUrl: PAGE, sourceKind: 'exa' },
    ]);
    const result = await service.select(store.caseId, [c.id]);
    expect(result.contacts).toEqual([]);
    expect(result.unavailable).toEqual([expect.objectContaining({ candidateId: c.id, channel: 'none' })]);
    expect(store.people).toEqual([]);
  });

  it('cannot create a contact from a forged or malformed contact point', async () => {
    const { store, service } = setup();
    const forged: Ev[][] = [
      // claim text around the address (a contact point claim must BE the address)
      [{ claimType: 'contact_point.email.new_patient_line', claim: 'Email intake@example.org', sourceUrl: PAGE, sourceKind: 'exa' }],
      // no tool source kind recorded
      [{ claimType: 'contact_point.email.new_patient_line', claim: 'intake@example.org', sourceUrl: PAGE }],
      // a tool that cannot vouch for this origin
      [{ claimType: 'contact_point.voice.nppes_location_phone', claim: '+16175550100', sourceUrl: PAGE, sourceKind: 'exa' }],
      // a named person's mailbox
      [{ claimType: 'contact_point.email.new_patient_line', claim: 'jane.doe@example.org', sourceUrl: PAGE, sourceKind: 'exa' }],
      // non-http source
      [{ claimType: 'contact_point.email.org_contact', claim: 'info@example.org', sourceUrl: 'javascript:alert(1)', sourceKind: 'exa' }],
      // unknown origin
      [{ claimType: 'contact_point.email.model_guess', claim: 'info@example.org', sourceUrl: PAGE, sourceKind: 'exa' }],
    ];
    const ids = forged.map(ev => store.add(ev).id);
    const result = await service.select(store.caseId, ids);
    expect(result.contacts).toEqual([]);
    expect(result.unavailable).toHaveLength(forged.length);
  });

  it('creates the contact from a code-stamped contact point, keeping the address exactly as the tool returned it', async () => {
    const { store, service } = setup();
    const ev = contactPointEvidence({ channel: 'email', address: 'Intake@Example.org', origin: 'new_patient_line', sourceUrl: PAGE, sourceKind: 'exa' }, '2026-10-23T00:00:00.000Z')!;
    const c = store.add([{ claimType: 'disease_program', claim: 'Write to newpatients@example.org', sourceUrl: PAGE, sourceKind: 'exa' }, ev]);
    const result = await service.select(store.caseId, [c.id]);
    expect(result.contacts).toEqual([expect.objectContaining({ channel: 'email', address: 'intake@example.org' })]);
  });

  it('parses contact points strictly from evidence rows', () => {
    const ok = contactPointEvidence({ channel: 'voice', address: '+1 (617) 632-3000', origin: 'ctgov_central_contact', sourceUrl: 'https://clinicaltrials.gov/study/NCT01234567', sourceKind: 'ctgov' }, '2026-10-23T00:00:00.000Z')!;
    expect(ok.claim).toBe('+16176323000');
    expect(parseContactPoints([ok])).toEqual([expect.objectContaining({ channel: 'voice', address: '+16176323000', sourceUrl: 'https://clinicaltrials.gov/study/NCT01234567' })]);
    expect(contactPointEvidence({ channel: 'email', address: 'dr.smith@example.org', origin: 'org_contact', sourceUrl: PAGE, sourceKind: 'exa' }, '2026-10-23T00:00:00.000Z')).toBeNull();
  });
});
