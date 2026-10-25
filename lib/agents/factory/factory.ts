/**
 * AgentFactory: when the patient approves the contact plan (selection and consent are confirmed by then), spawn one
 * ResourceAgent per planned resource. Idempotent: (case_id, resource_key) is unique, so re-approval or a retry
 * returns the same agents. Each new agent gets its own inbox (or the recorded fallback) and a 'spawned' event, and is
 * due immediately so its first step runs right away (or on the next sweep).
 */
import type { ContactPlan, ResourcePlan } from '../../plan/contract';
import { goalFor, strategyFor } from './policy';
import { provisionAgentInbox, type InboxProvider } from './inbox';
import type { AgentStore } from './store';
import { emptyMemory, type ResourceAgent } from './types';

export interface SpawnDeps {
  store: AgentStore;
  inboxProvider: InboxProvider | null;
  sharedInboxId?: string | null;
  /** The resource's phone number for inbound-call matching (voice contacts), when known. */
  resourcePhone?: (r: ResourcePlan) => Promise<string | null>;
  now?: () => Date;
}

export function agentName(r: Pick<ResourcePlan, 'name'>): string {
  return `${r.name.trim().slice(0, 80)} agent`;
}

export async function spawnAgentsForPlan(plan: ContactPlan, deps: SpawnDeps): Promise<{ agents: ResourceAgent[]; created: number }> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const agents: ResourceAgent[] = [];
  let created = 0;
  for (const r of plan.resources) {
    const strategy = strategyFor(r);
    if (strategy.length === 0) continue; // no tool-sourced channel: nothing for an agent to do
    const phone = await deps.resourcePhone?.(r).catch(() => null) ?? null;
    const { agent, created: isNew } = await deps.store.upsert({
      caseId: plan.caseId, contactId: r.contactId, resourceKey: r.resourceKey, name: agentName(r), goal: goalFor(r), strategy,
      memory: { ...emptyMemory(), resourcePhone: phone, remaining: [`reach ${r.name}`] }, nextAction: 'first step', nextActionAt: now,
    });
    let current = agent;
    if (isNew || agent.inboxMode === 'pending') {
      const inbox = strategy.includes('email') ? await provisionAgentInbox(agent, { provider: deps.inboxProvider, sharedInboxId: deps.sharedInboxId ?? null })
        : { mode: 'none' as const, inboxId: null, address: null, reason: 'no email in this strategy' };
      await deps.store.update(agent.id, { inboxMode: inbox.mode, inboxId: inbox.inboxId, inboxAddress: inbox.address });
      current = { ...agent, inboxMode: inbox.mode, inboxId: inbox.inboxId, inboxAddress: inbox.address };
      await deps.store.appendEvent({
        agentId: agent.id, caseId: plan.caseId, kind: 'spawned', trigger: 'spawn', action: null,
        reason: `goal ${agent.goal.replace('_', ' ')}; plan ${strategy.join(' then ')}`,
        result: inbox.mode === 'own' ? `own inbox ${inbox.address}` : `inbox: ${inbox.mode}${inbox.reason ? ` (${inbox.reason})` : ''}`,
      });
    }
    if (isNew) created += 1;
    agents.push(current);
  }
  return { agents, created };
}
