import { sql } from "drizzle-orm";
import { hasDatabase, isoOrNull, queryRows, tableExists, truncate } from "../db";
import type { ActivityEvent, ActivitySource } from "../types";

/**
 * Lane F (agent factory) per-resource agent decisions. Contract:
 * /private/tmp/claude-501/-Users-ronitkatikaneni/abf3d0ff-bb8e-4c7c-bab2-98f67d5b237e/scratchpad/briefs/r3-factory-contract.md
 * Tables resource_agents / agent_events may not exist yet (migration 0051), so this source is guarded by to_regclass.
 */
export interface AgentEventRow {
  id: string;
  contact_id: string | null;
  agent_name: string | null;
  kind: string;
  trigger: string | null;
  reason: string | null;
  action: string | null;
  result: string | null;
  created_at: Date | string;
}

const ACTION_LABEL: Record<string, string> = {
  draft_email: "drafted an email", draft_call: "drafted a call", fill_web: "filled an online form", follow_up: "scheduled a follow-up",
  answer_request: "answered a request", switch_channel: "switched channel", escalate: "escalated to you", finish: "finished", wait: "is waiting",
};

/** Pure: agent_events rows -> events. `reason` is model-written text: shown as plain text, shortened. */
export function agentDecisionEvents(rows: AgentEventRow[]): ActivityEvent[] {
  return rows.flatMap((r) => {
    const at = isoOrNull(r.created_at);
    if (!at) return [];
    const who = r.agent_name ?? "Agent";
    const what = r.action ? ACTION_LABEL[r.action] ?? r.action.replace(/_/g, " ") : r.kind;
    const detail = [r.reason, r.result].filter(Boolean).join(" — ");
    return [{
      id: `agentev:${r.id}`, at, kind: "agent_decision" as const, contactId: r.contact_id,
      title: `${who} ${what}`, detail: detail ? truncate(detail, 320) : undefined,
      meta: { eventKind: r.kind, trigger: r.trigger, action: r.action },
    }];
  });
}

export const agentEventsSource: ActivitySource = {
  name: "agent-events",
  async load(caseId) {
    if (!hasDatabase()) return { events: [] };
    const [events, agents] = await Promise.all([tableExists("agent_events"), tableExists("resource_agents")]);
    if (!events || !agents) return { events: [] };
    const rows = await queryRows<AgentEventRow>(sql`
      select e.id::text as id, a.contact_id::text as contact_id, a.name as agent_name, e.kind, e.trigger, e.reason, e.action, e.result, e.created_at
      from public.agent_events e join public.resource_agents a on a.id = e.agent_id
      where e.case_id = ${caseId}::uuid order by e.created_at desc limit 150`);
    return { events: agentDecisionEvents(rows) };
  },
};
