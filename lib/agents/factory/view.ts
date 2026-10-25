/** Read model for the judge cards and the live console: each agent with its own events, calls and applications. */
import { sql } from 'drizzle-orm';
import { getDb } from '../../../db/client';
import { getAgentStore } from './store';
import type { AgentEvent, ResourceAgent } from './types';

export interface AgentCard extends Omit<ResourceAgent, 'memory'> {
  memory: Pick<ResourceAgent['memory'], 'summary' | 'remaining' | 'replies' | 'calls' | 'applications' | 'spokeWith'>;
  events: AgentEvent[];
  calls: { id: string; startedAt: string | null; outcome: string | null }[];
  applications: { id: string; status: string; url: string }[];
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? res : (res as { rows: Row[] }).rows) as Row[];
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export async function agentCards(caseId: string, eventLimit = 3): Promise<AgentCard[]> {
  const store = getAgentStore();
  const agents = await store.listByCase(caseId);
  const limit = Math.max(1, Math.min(50, eventLimit));
  return Promise.all(agents.map(async a => {
    const [events, calls, apps] = await Promise.all([
      store.events(a.id, limit),
      a.contactId ? getDb().execute(sql`SELECT id, started_at, outcome FROM calls WHERE contact_id = ${a.contactId}::uuid ORDER BY started_at DESC NULLS FIRST LIMIT 5`).then(rowsOf) : Promise.resolve([]),
      getDb().execute(sql`SELECT id, status, url FROM web_applications WHERE case_id = ${caseId}::uuid AND ${a.contactId ? sql`contact_id = ${a.contactId}::uuid` : sql`contact_id IS NULL`} ORDER BY id LIMIT 5`).then(rowsOf),
    ]);
    const { memory, ...rest } = a;
    return {
      ...rest,
      memory: { summary: memory.summary, remaining: memory.remaining, replies: memory.replies, calls: memory.calls, applications: memory.applications, spokeWith: memory.spokeWith },
      events,
      calls: calls.map(c => ({ id: String(c.id), startedAt: iso(c.started_at), outcome: (c.outcome as string | null) ?? null })),
      applications: apps.map(w => ({ id: String(w.id), status: String(w.status), url: String(w.url) })),
    };
  }));
}
