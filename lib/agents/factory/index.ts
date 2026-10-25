/** Agent factory entry points used by routes, webhooks and cron. All are safe no-ops without DATABASE_URL. */
import type { ContactPlan } from '../../plan/contract';
import type { AgentTrigger } from './types';

export * from './types';
export { agentHookToken } from './runner';

const hasDb = () => !!process.env.DATABASE_URL;

/** Spawns one agent per planned resource (idempotent) and runs each one's first step. Never throws. */
export async function spawnForApprovedPlan(plan: ContactPlan): Promise<{ created: number; agents: number } | null> {
  if (!hasDb()) return null;
  try {
    const [{ spawnAgentsForPlan }, { getAgentStore }, { agentMailInboxProvider }, { runAgent }, { defaultAgentDeps }] = await Promise.all([
      import('./factory'), import('./store'), import('./inbox'), import('./runner'), import('./default-deps'),
    ]);
    const { agents, created } = await spawnAgentsForPlan(plan, {
      store: getAgentStore(), inboxProvider: agentMailInboxProvider(), sharedInboxId: process.env.AGENTMAIL_SENDER_INBOX_ID?.trim() || null,
      resourcePhone: async r => {
        if (!r.contactId) return null;
        const { getDb } = await import('../../../db/client');
        const { sql } = await import('drizzle-orm');
        const res = await getDb().execute(sql`SELECT address FROM contacts WHERE id = ${r.contactId}::uuid AND channel = 'voice'`);
        const rows = (Array.isArray(res) ? res : (res as unknown as { rows: { address: string }[] }).rows) as { address: string }[];
        return rows[0]?.address ?? null;
      },
    });
    const deps = defaultAgentDeps();
    await Promise.allSettled(agents.map(a => runAgent(a.id, deps, 'spawn')));
    return { created, agents: agents.length };
  } catch (err) {
    console.error('[agent-factory] spawn failed', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/** Webhook wake-up for the agent that owns this contact. Never throws. */
export async function wakeAgent(contactId: string, trigger: AgentTrigger): Promise<void> {
  if (!hasDb() || !contactId) return;
  try {
    const [{ wakeAgentForContact }, { defaultAgentDeps }] = await Promise.all([import('./runner'), import('./default-deps')]);
    await wakeAgentForContact(contactId, trigger, defaultAgentDeps());
  } catch (err) {
    console.error('[agent-factory] wake failed', err instanceof Error ? err.name : 'error');
  }
}

/** Cron entry: runs agents whose next_action_at is due (leased, never overlapping), then sends due patient digests. */
export async function runDueAgents(): Promise<{ ran: number; skipped: number; failed: number; digests?: { sent: number; skipped: number } }> {
  if (!hasDb()) return { ran: 0, skipped: 0, failed: 0 };
  const [{ sweepDueAgents }, { defaultAgentDeps }, { sendDigests }] = await Promise.all([import('./runner'), import('./default-deps'), import('./chat-deps')]);
  const ran = await sweepDueAgents(defaultAgentDeps());
  const digests = await sendDigests().catch(err => { console.error('[agent-factory] digest failed', err instanceof Error ? err.name : 'error'); return { sent: 0, skipped: 0 }; });
  return { ...ran, digests };
}

/** Kernel completion (application submitted): wakes the agent that owns the application. Never throws. */
export async function wakeAgentForApplication(caseId: string, contactId: string | null): Promise<void> {
  if (!hasDb()) return;
  try {
    if (contactId) return await wakeAgent(contactId, 'webhook:kernel');
    const [{ getAgentStore }, { runAgent }, { defaultAgentDeps }] = await Promise.all([import('./store'), import('./runner'), import('./default-deps')]);
    const agents = (await getAgentStore().listByCase(caseId)).filter(a => !a.contactId && a.strategy.includes('web'));
    const deps = defaultAgentDeps();
    await Promise.allSettled(agents.map(a => runAgent(a.id, deps, 'webhook:kernel')));
  } catch (err) {
    console.error('[agent-factory] application wake failed', err instanceof Error ? err.name : 'error');
  }
}
