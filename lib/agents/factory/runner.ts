/**
 * Thin scheduling adapter around step(): lease -> step (a few times when it asks to continue) -> release.
 * Used by webhooks (wake now), the cron sweep (next_action_at due) and the judge's "Run now". A later durable
 * Workflow run can replace this file; step() does not change. Hook token: agentHookToken(id).
 */
import { randomUUID } from 'node:crypto';
import { agentLeaseMs, type AgentStore } from './store';
import { step, type StepDeps, type StepResult } from './step';
import type { AgentTrigger } from './types';

export const MAX_STEPS_PER_RUN = 3;
export const DEFAULT_SWEEP_LIMIT = 10;
export const agentHookToken = (agentId: string) => `resource-agent:${agentId}`;

/** A short, secret-free error message for the agent's event log (no connection strings, no query params). */
function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\nparams:')[0].replace(/postgres(ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300);
}

export type RunOutcome = { agentId: string; skipped: 'lease' | 'not_found' } | { agentId: string; steps: StepResult[] };

export async function runAgent(agentId: string, deps: StepDeps & { leaseMs?: number }, trigger: AgentTrigger): Promise<RunOutcome> {
  const now = deps.now?.() ?? new Date();
  const owner = `${trigger}:${randomUUID()}`;
  if (!await deps.store.get(agentId)) return { agentId, skipped: 'not_found' };
  if (!await deps.store.acquireLease(agentId, owner, now, deps.leaseMs ?? agentLeaseMs())) {
    return { agentId, skipped: 'lease' };
  }
  const steps: StepResult[] = [];
  try {
    for (let i = 0; i < MAX_STEPS_PER_RUN; i++) {
      const r = await step(agentId, deps, trigger);
      steps.push(r);
      if (!r.again || r.done) break;
    }
  } catch (err) {
    const agent = await deps.store.get(agentId).catch(() => null);
    if (agent) await deps.store.appendEvent({ agentId, caseId: agent.caseId, kind: 'error', trigger, reason: null, action: null, result: err instanceof Error ? err.name : 'error', data: { message: errorMessage(err) } }).catch(() => undefined);
    console.error('[resource-agent] step failed', errorMessage(err));
    throw err;
  } finally {
    await deps.store.releaseLease(agentId, owner).catch(() => undefined);
  }
  return { agentId, steps };
}

/** Webhook entry: wakes the agent that owns this contact, if any. Never throws into the webhook. */
export async function wakeAgentForContact(contactId: string, trigger: AgentTrigger, deps: StepDeps & { leaseMs?: number }): Promise<RunOutcome | null> {
  try {
    const agent = await deps.store.byContact(contactId);
    if (!agent) return null;
    return await runAgent(agent.id, deps, trigger);
  } catch (err) {
    console.error('[resource-agent] wake failed', err instanceof Error ? err.name : 'error');
    return null;
  }
}

export async function sweepDueAgents(deps: StepDeps & { leaseMs?: number; limit?: number }): Promise<{ ran: number; skipped: number; failed: number }> {
  const now = deps.now?.() ?? new Date();
  const ids = await deps.store.due(now, deps.limit ?? DEFAULT_SWEEP_LIMIT);
  const out = { ran: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    try {
      const r = await runAgent(id, deps, 'cron');
      if ('skipped' in r) out.skipped += 1; else out.ran += 1;
    } catch { out.failed += 1; }
  }
  return out;
}

/** Store-only dependency check used by the routes so they can show a clean error. */
export type { AgentStore };
