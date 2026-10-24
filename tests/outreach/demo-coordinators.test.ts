import { describe, expect, it } from 'vitest';
import {
  demoCoordinatorFor,
  demoCoordinatorInboxes,
  demoCoordinatorsEnabled,
  isDemoCoordinatorAddress,
} from '../../lib/outreach/demo-coordinators';
import { OutreachService } from '../../lib/outreach/service';
import { DEMO_CALL_SINK } from '../../lib/outreach/demo-destinations';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { activeContactCount } from '../../lib/safety/caps';
import { OutreachError, type Candidate, type Contact, type OutreachStore } from '../../lib/outreach/types';

const ALLOW = 'sender@agentmail.to,coord-a@agentmail.to,Coord-B@agentmail.to,+14155550123';

describe('demo coordinator config', () => {
  it('is off unless WAYFINDER_DEMO_COORDINATORS is exactly 1', () => {
    expect(demoCoordinatorsEnabled({})).toBe(false);
    expect(demoCoordinatorsEnabled({ WAYFINDER_DEMO_COORDINATORS: 'true' })).toBe(false);
    expect(demoCoordinatorsEnabled({ WAYFINDER_DEMO_COORDINATORS: '1' })).toBe(true);
    expect(demoCoordinatorInboxes({ OUTBOUND_ALLOWLIST: ALLOW })).toEqual([]);
  });

  it('defaults to allowlisted emails minus the sender inbox', () => {
    const env = { WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: ALLOW, AGENTMAIL_SENDER_INBOX_ID: 'sender@agentmail.to' };
    expect(demoCoordinatorInboxes(env)).toEqual(['coord-a@agentmail.to', 'coord-b@agentmail.to']);
  });

  it('uses DEMO_COORDINATOR_INBOXES but only entries that are also allowlisted', () => {
    const env = {
      WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: ALLOW, AGENTMAIL_SENDER_INBOX_ID: 'sender@agentmail.to',
      DEMO_COORDINATOR_INBOXES: 'coord-b@agentmail.to,real-hospital@example.org,sender@agentmail.to',
    };
    expect(demoCoordinatorInboxes(env)).toEqual(['coord-b@agentmail.to']);
    expect(isDemoCoordinatorAddress('COORD-B@agentmail.to', env)).toBe(true);
    expect(isDemoCoordinatorAddress('coord-a@agentmail.to', env)).toBe(false);
    expect(isDemoCoordinatorAddress('real-hospital@example.org', env)).toBe(false);
  });

  it('picks a stable inbox per resource', () => {
    const inboxes = ['a@x.to', 'b@x.to'];
    expect(demoCoordinatorFor('institution:1', inboxes)).toBe(demoCoordinatorFor('institution:1', inboxes));
    expect(inboxes).toContain(demoCoordinatorFor('trial:NCT1', inboxes));
    expect(demoCoordinatorFor('x', [])).toBeUndefined();
  });
});

class Store implements Partial<OutreachStore> {
  caseId = 'case-1';
  people: Contact[] = [];
  choices: Candidate[] = [];
  async getCase() { return { diseaseName: 'vEDS', homeState: 'OH' }; }
  async candidates(_c: string, ids: string[]) { return this.choices.filter(c => ids.includes(c.id)); }
  async contacts() { return [...this.people]; }
  // Mirrors PostgresOutreachStore: one contact per case and address; returns every contact on a proposed address.
  async select(_c: string, contacts: Contact[], cap: number, opts: { sharedAddresses?: readonly string[] } = {}) {
    const norm = (a: string) => a.trim().toLowerCase();
    const shared = new Set((opts.sharedAddresses ?? []).map(norm));
    const key = (c: Contact) => shared.has(norm(c.address)) ? `${norm(c.address)}|${c.targetKind}:${c.targetId}` : norm(c.address);
    const fresh = contacts.filter((p, i) => !this.people.some(c => key(c) === key(p)) && contacts.findIndex(o => key(o) === key(p)) === i);
    if (activeContactCount(this.people) + fresh.length > cap) throw new OutreachError(422, ['contact_cap']);
    this.people.push(...fresh);
    return this.people.filter(c => contacts.some(p => key(p) === key(c)));
  }
}

function service(env: Record<string, string>) {
  const store = new Store();
  store.choices = [
    { id: 'c1', caseId: 'case-1', targetId: 't1', targetKind: 'institution', evidence: [] },
    { id: 'c2', caseId: 'case-1', targetId: 't2', targetKind: 'trial', evidence: [{ claim: 'intake@hospital.org', claimType: 'contact_point.email.new_patient_line', sourceUrl: 'https://hospital.org', sourceKind: 'exa' } as Candidate['evidence'][number]] },
  ];
  return { store, svc: new OutreachService(store as unknown as OutreachStore, [new MockChannel('email'), new MockChannel('voice')], env) };
}

describe('OutreachService.select in demo coordinator mode', () => {
  it('keeps the real channel of each resource and only swaps the destination; doorless resources stay unavailable', async () => {
    const { store, svc } = service({ WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: 'demo@agentmail.to,demo2@agentmail.to' });
    store.choices.push({ id: 'c3', caseId: 'case-1', targetId: 't3', targetKind: 'trial', evidence: [{ claim: '+15075550100', claimType: 'contact_point.voice.ctgov_central_contact', sourceUrl: 'https://clinicaltrials.gov/study/NCT1', sourceKind: 'ctgov' } as Candidate['evidence'][number]] });
    const res = await svc.select('case-1', ['c1', 'c2', 'c3']);
    expect(res.unavailable.map(u => u.candidateId)).toEqual(['c1']);
    expect(res.contacts.map(c => [c.targetId, c.channel])).toEqual([['t2', 'email'], ['t3', 'voice']]);
    expect(['demo@agentmail.to', 'demo2@agentmail.to']).toContain(res.contacts[0].address);
    // No test phone is allowlisted: the call goes to the reserved, never-dialed demo sink, not the trial's number.
    expect(res.contacts[1].address).toBe(DEMO_CALL_SINK);
  });

  it('lets several contacts share the single demo inbox and the call sink (one contact per resource), up to the cap of 5', async () => {
    const { store, svc } = service({ WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: 'demo@agentmail.to' });
    const door = store.choices[1].evidence;
    for (let i = 3; i <= 7; i++) store.choices.push({ id: `c${i}`, caseId: 'case-1', targetId: `t${i}`, targetKind: 'institution', evidence: door });
    const res = await svc.select('case-1', ['c2', 'c3']);
    expect(res.unavailable).toEqual([]);
    expect(res.contacts.map(c => c.address)).toEqual(['demo@agentmail.to', 'demo@agentmail.to']);
    expect(new Set(res.contacts.map(c => c.id)).size).toBe(2);
    expect((await svc.select('case-1', ['c2', 'c3'])).contacts).toHaveLength(2);
    await svc.select('case-1', ['c4', 'c5', 'c6']);
    expect(store.people).toHaveLength(5);
    await expect(svc.select('case-1', ['c7'])).rejects.toMatchObject({ status: 422, reasons: ['contact_cap'] });
  });

  it('reports a resource whose only real address is already used by another contact', async () => {
    const { store, svc } = service({ OUTBOUND_ALLOWLIST: 'intake@hospital.org' });
    const door = store.choices[1].evidence;
    store.choices.push({ id: 'c3', caseId: 'case-1', targetId: 't3', targetKind: 'expert', evidence: door });
    const res = await svc.select('case-1', ['c2', 'c3']);
    expect(res.contacts.map(c => c.targetId)).toEqual(['t2']);
    expect(res.unavailable.map(u => u.candidateId)).toEqual(['c3']);
  });

  it('keeps the real contact points when the mode is off', async () => {
    const { svc } = service({ OUTBOUND_ALLOWLIST: 'demo@agentmail.to' });
    const res = await svc.select('case-1', ['c1', 'c2']);
    expect(res.contacts.map(c => c.address)).toEqual(['intake@hospital.org']);
    expect(res.unavailable).toHaveLength(1);
  });

  it('falls back to real contact points when no coordinator inbox is allowlisted', async () => {
    const { svc } = service({ WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: '' });
    const res = await svc.select('case-1', ['c1', 'c2']);
    expect(res.contacts.map(c => c.address)).toEqual(['intake@hospital.org']);
  });
});
