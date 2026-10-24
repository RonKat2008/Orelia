import { describe, expect, it } from 'vitest';
import {
  demoCoordinatorFor,
  demoCoordinatorInboxes,
  demoCoordinatorsEnabled,
  isDemoCoordinatorAddress,
} from '../../lib/outreach/demo-coordinators';
import { OutreachService } from '../../lib/outreach/service';
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
  async select(_c: string, contacts: Contact[], cap: number) {
    if (activeContactCount(this.people) + contacts.length > cap) throw new OutreachError(422, ['contact_cap']);
    this.people.push(...contacts); return contacts;
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
  it('routes every selected resource (even doorless ones) to a demo inbox, never the real address', async () => {
    const { svc } = service({ WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: 'demo@agentmail.to' });
    const res = await svc.select('case-1', ['c1', 'c2']);
    expect(res.unavailable).toEqual([]);
    expect(res.contacts.map(c => [c.channel, c.address])).toEqual([['email', 'demo@agentmail.to'], ['email', 'demo@agentmail.to']]);
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
