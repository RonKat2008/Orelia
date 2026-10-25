import { describe, expect, it } from 'vitest';
import { spawnAgentsForPlan } from '@/lib/agents/factory/factory';
import { MemoryAgentStore } from '@/lib/agents/factory/store';
import { routeInboundEmail, matchInboundCall, provisionAgentInbox, type InboxProvider } from '@/lib/agents/factory/inbox';
import { CASE, plan, resource, step } from './helpers';

const twoResources = plan([
  resource('institution:cc', 'Cleveland Clinic', [step('s1', 1, 'email'), step('s2', 2, 'voice', 'business_days:3')], 'c1'),
  resource('trial:nct1', 'NCT0001 trial', [step('s1', 1, 'voice')], 'c2', 'trial', 'trial_call_only'),
  resource('organization:aid', 'Aid Fund', [step('s1', 1, 'web_form', 'none', 'apply', 'https://aid.example/apply')], null, 'organization', 'aid_form_only'),
  resource('institution:none', 'No Channel', [], null),
]);

function countingProvider(fail = false): InboxProvider & { creates: string[] } {
  const creates: string[] = [];
  return {
    creates,
    async create(input) {
      creates.push(input.clientId);
      if (fail) throw Object.assign(new Error('limit'), { statusCode: 403 });
      return { inboxId: `inbox-${input.clientId}`, email: `${input.username}@agentmail.to` };
    },
  };
}

describe('AgentFactory', () => {
  it('spawns exactly one agent per resource with a channel, with goal and strategy', async () => {
    const store = new MemoryAgentStore();
    const { agents, created } = await spawnAgentsForPlan(twoResources, { store, inboxProvider: countingProvider() });
    expect(created).toBe(3);
    expect(agents.map(a => [a.name, a.goal, a.strategy.join('>')])).toEqual([
      ['Cleveland Clinic agent', 'appointment', 'email>call'],
      ['NCT0001 trial agent', 'trial_screening', 'call'],
      ['Aid Fund agent', 'aid_application', 'web'],
    ]);
    expect((await store.listByCase(CASE)).length).toBe(3);
    expect(store.eventLog.filter(e => e.kind === 'spawned').length).toBe(3);
  });

  it('is idempotent: a second spawn creates nothing and the inbox is created once per agent', async () => {
    const store = new MemoryAgentStore();
    const provider = countingProvider();
    await spawnAgentsForPlan(twoResources, { store, inboxProvider: provider });
    const again = await spawnAgentsForPlan(twoResources, { store, inboxProvider: provider });
    expect(again.created).toBe(0);
    expect((await store.listByCase(CASE)).length).toBe(3);
    // Only the email-strategy agent gets an inbox; exactly once.
    expect(provider.creates.length).toBe(1);
    const cc = (await store.listByCase(CASE)).find(a => a.resourceKey === 'institution:cc')!;
    expect(cc.inboxMode).toBe('own');
    expect(cc.inboxAddress).toMatch(/@agentmail\.to$/);
  });

  it('falls back to the case inbox with a per-agent thread when inbox creation fails', async () => {
    const store = new MemoryAgentStore();
    await spawnAgentsForPlan(twoResources, { store, inboxProvider: countingProvider(true), sharedInboxId: 'case-inbox' });
    const cc = (await store.listByCase(CASE)).find(a => a.resourceKey === 'institution:cc')!;
    expect(cc.inboxMode).toBe('shared');
    expect(cc.inboxId).toBe('case-inbox');
    expect(store.eventLog.find(e => e.agentId === cc.id)?.result).toMatch(/inbox: shared/);
  });

  it('provision keeps an existing own inbox', async () => {
    const provider = countingProvider();
    const r = await provisionAgentInbox({ id: 'a', caseId: CASE, name: 'X agent', inboxMode: 'own', inboxId: 'i1', inboxAddress: 'x@a.to' }, { provider });
    expect(r).toEqual({ mode: 'own', inboxId: 'i1', address: 'x@a.to' });
    expect(provider.creates).toEqual([]);
  });
});

describe('per-agent channel ownership', () => {
  const agentA = { contactId: 'cA', caseId: CASE, inboxMode: 'own' as const, inboxId: 'inbox-A' };
  const agentB = { contactId: 'cB', caseId: CASE, inboxMode: 'own' as const, inboxId: 'inbox-B' };

  it("inbound mail to agent A's inbox never reaches agent B", () => {
    // B's thread, but delivered into A's inbox: refused.
    expect(routeInboundEmail({ inboxId: 'inbox-A', threadOwner: { contactId: 'cB', caseId: CASE }, ownerAgent: agentB, inboxAgent: agentA })).toEqual({ refused: 'inbox_mismatch' });
    // A new thread in A's inbox routes to A only.
    expect(routeInboundEmail({ inboxId: 'inbox-A', threadOwner: undefined, ownerAgent: null, inboxAgent: agentA })).toEqual({ contactId: 'cA', caseId: CASE });
    // A's own thread in A's inbox.
    expect(routeInboundEmail({ inboxId: 'inbox-A', threadOwner: { contactId: 'cA', caseId: CASE }, ownerAgent: agentA, inboxAgent: agentA })).toEqual({ contactId: 'cA', caseId: CASE });
  });

  it('shared-mode agents route by thread', () => {
    const shared = { inboxMode: 'shared' as const, inboxId: 'case-inbox' };
    expect(routeInboundEmail({ inboxId: 'case-inbox', threadOwner: { contactId: 'cB', caseId: CASE }, ownerAgent: shared, inboxAgent: null })).toEqual({ contactId: 'cB', caseId: CASE });
    expect(routeInboundEmail({ inboxId: 'case-inbox', threadOwner: undefined, ownerAgent: null, inboxAgent: null })).toEqual({ refused: 'unknown' });
  });

  it('matches inbound calls on the shared number by caller id, else unmatched', () => {
    const agents = [{ id: 'a1', resourcePhone: '+1 (216) 555-0101' }, { id: 'a2', resourcePhone: '2165550199' }, { id: 'a3', resourcePhone: null }];
    expect(matchInboundCall('+12165550101', agents)).toBe('a1');
    expect(matchInboundCall('216-555-0199', agents)).toBe('a2');
    expect(matchInboundCall('+13105550000', agents)).toBe('unmatched');
    expect(matchInboundCall('anonymous', agents)).toBe('unmatched');
  });
});
