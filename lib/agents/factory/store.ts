/**
 * Persistence for ResourceAgents and their events. Spawning is idempotent on (case_id, resource_key); a run holds a
 * lease (lease_owner + lease_until) taken with ONE atomic UPDATE, so overlapping runs (cron + webhook + Run now)
 * never act on the same agent at once.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '../../../db/client';
import { emptyMemory, type AgentEvent, type InboxMode, type ResourceAgent } from './types';

export const DEFAULT_AGENT_LEASE_MS = 15 * 60_000; // >= route maxDuration, per r3-lease-contract.md
export function agentLeaseMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.AGENT_LEASE_MS);
  return Number.isFinite(n) && n >= 5_000 ? n : DEFAULT_AGENT_LEASE_MS;
}

export type NewAgent = Pick<ResourceAgent, 'caseId' | 'contactId' | 'resourceKey' | 'name' | 'goal' | 'strategy'> & Partial<Pick<ResourceAgent, 'memory' | 'nextAction' | 'nextActionAt'>>;
export type AgentPatch = Partial<Pick<ResourceAgent, 'strategyStep' | 'state' | 'nextAction' | 'nextActionAt' | 'memory' | 'lastRunAt' | 'inboxMode' | 'inboxId' | 'inboxAddress' | 'contactId' | 'strategy'>>;

export interface AgentStore {
  /** Inserts unless an agent for (caseId, resourceKey) exists. Returns the stored agent and whether it was created. */
  upsert(input: NewAgent): Promise<{ agent: ResourceAgent; created: boolean }>;
  get(id: string): Promise<ResourceAgent | null>;
  byContact(contactId: string): Promise<ResourceAgent | null>;
  byInbox(inboxId: string): Promise<ResourceAgent | null>;
  listByCase(caseId: string): Promise<ResourceAgent[]>;
  update(id: string, patch: AgentPatch): Promise<void>;
  /** True when this owner now holds the lease (free or expired before). */
  acquireLease(id: string, owner: string, now: Date, ms: number): Promise<boolean>;
  releaseLease(id: string, owner: string): Promise<void>;
  /** Agent ids whose next_action_at is due and whose lease is free, oldest first. */
  due(now: Date, limit: number): Promise<string[]>;
  appendEvent(e: Omit<AgentEvent, 'id' | 'createdAt'> & { createdAt?: string }): Promise<AgentEvent>;
  events(agentId: string, limit: number): Promise<AgentEvent[]>;
}

export class MemoryAgentStore implements AgentStore {
  agents = new Map<string, ResourceAgent & { leaseOwner: string | null; leaseUntil: number }>();
  eventLog: AgentEvent[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}
  private strip(a: ResourceAgent & { leaseOwner: string | null; leaseUntil: number }): ResourceAgent {
    const rest: Partial<typeof a> = { ...a };
    delete rest.leaseOwner;
    delete rest.leaseUntil;
    return structuredClone(rest as ResourceAgent);
  }
  async upsert(input: NewAgent) {
    const found = [...this.agents.values()].find(a => a.caseId === input.caseId && a.resourceKey === input.resourceKey);
    if (found) return { agent: this.strip(found), created: false };
    const agent: ResourceAgent = {
      id: randomUUID(), caseId: input.caseId, contactId: input.contactId, resourceKey: input.resourceKey, name: input.name, goal: input.goal,
      strategy: [...input.strategy], strategyStep: 0, state: 'planning', nextAction: input.nextAction ?? null, nextActionAt: input.nextActionAt ?? null,
      memory: input.memory ?? emptyMemory(), inboxMode: 'pending' as InboxMode, inboxId: null, inboxAddress: null,
      createdAt: this.clock().toISOString(), lastRunAt: null,
    };
    this.agents.set(agent.id, { ...agent, leaseOwner: null, leaseUntil: 0 });
    return { agent: structuredClone(agent), created: true };
  }
  async get(id: string) { const a = this.agents.get(id); return a ? this.strip(a) : null; }
  async byContact(contactId: string) { const a = [...this.agents.values()].find(x => x.contactId === contactId); return a ? this.strip(a) : null; }
  async byInbox(inboxId: string) { const a = [...this.agents.values()].find(x => x.inboxMode === 'own' && x.inboxId === inboxId); return a ? this.strip(a) : null; }
  async listByCase(caseId: string) { return [...this.agents.values()].filter(a => a.caseId === caseId).map(a => this.strip(a)); }
  async update(id: string, patch: AgentPatch) {
    const a = this.agents.get(id);
    if (a) this.agents.set(id, { ...a, ...structuredClone(patch) });
  }
  async acquireLease(id: string, owner: string, now: Date, ms: number) {
    const a = this.agents.get(id);
    if (!a || (a.leaseOwner && a.leaseUntil > now.getTime())) return false;
    this.agents.set(id, { ...a, leaseOwner: owner, leaseUntil: now.getTime() + ms });
    return true;
  }
  async releaseLease(id: string, owner: string) {
    const a = this.agents.get(id);
    if (a && a.leaseOwner === owner) this.agents.set(id, { ...a, leaseOwner: null, leaseUntil: 0 });
  }
  async due(now: Date, limit: number) {
    return [...this.agents.values()]
      .filter(a => a.nextActionAt && Date.parse(a.nextActionAt) <= now.getTime() && !(a.leaseOwner && a.leaseUntil > now.getTime()) && a.state !== 'done')
      .sort((x, y) => Date.parse(x.nextActionAt!) - Date.parse(y.nextActionAt!)).slice(0, limit).map(a => a.id);
  }
  async appendEvent(e: Omit<AgentEvent, 'id' | 'createdAt'> & { createdAt?: string }) {
    const ev: AgentEvent = { ...e, id: randomUUID(), createdAt: e.createdAt ?? this.clock().toISOString() };
    this.eventLog.push(ev);
    return ev;
  }
  async events(agentId: string, limit: number) {
    return this.eventLog.filter(e => e.agentId === agentId).slice(-limit).reverse();
  }
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? res : (res as { rows: Row[] }).rows) as Row[];
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

function toAgent(r: Row): ResourceAgent {
  return {
    id: String(r.id), caseId: String(r.case_id), contactId: r.contact_id ? String(r.contact_id) : null, resourceKey: String(r.resource_key),
    name: String(r.name), goal: r.goal as ResourceAgent['goal'], strategy: (r.strategy ?? []) as ResourceAgent['strategy'],
    strategyStep: Number(r.strategy_step ?? 0), state: r.state as ResourceAgent['state'], nextAction: (r.next_action as string | null) ?? null,
    nextActionAt: iso(r.next_action_at), memory: { ...emptyMemory(), ...((r.memory ?? {}) as object) },
    inboxMode: (r.inbox_mode as InboxMode) ?? 'pending', inboxId: (r.inbox_id as string | null) ?? null, inboxAddress: (r.inbox_address as string | null) ?? null,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(), lastRunAt: iso(r.last_run_at),
  };
}
function toEvent(r: Row): AgentEvent {
  return {
    id: String(r.id), agentId: String(r.agent_id), caseId: String(r.case_id), kind: r.kind as AgentEvent['kind'], trigger: (r.trigger as AgentEvent['trigger']) ?? null,
    reason: (r.reason as string | null) ?? null, action: (r.action as AgentEvent['action']) ?? null, result: (r.result as string | null) ?? null,
    data: (r.data as Record<string, unknown> | null) ?? null, createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}
const COLS = sql.raw('id, case_id, contact_id, resource_key, name, goal, strategy, strategy_step, state, next_action, next_action_at, memory, inbox_mode, inbox_id, inbox_address, created_at, last_run_at');
const PATCH_COLUMNS: Record<keyof AgentPatch, string> = {
  strategyStep: 'strategy_step', state: 'state', nextAction: 'next_action', nextActionAt: 'next_action_at', memory: 'memory', lastRunAt: 'last_run_at',
  inboxMode: 'inbox_mode', inboxId: 'inbox_id', inboxAddress: 'inbox_address', contactId: 'contact_id', strategy: 'strategy',
};
const JSON_COLS = new Set(['memory', 'strategy']);
const TIME_COLS = new Set(['next_action_at', 'last_run_at']);

export class PostgresAgentStore implements AgentStore {
  private q(query: ReturnType<typeof sql>) { return getDb().execute(query).then(rowsOf); }
  async upsert(input: NewAgent) {
    const inserted = await this.q(sql`
      INSERT INTO resource_agents (case_id, contact_id, resource_key, name, goal, strategy, memory, next_action, next_action_at)
      VALUES (${input.caseId}::uuid, ${input.contactId}::uuid, ${input.resourceKey}, ${input.name}, ${input.goal}, ${JSON.stringify(input.strategy)}::jsonb,
        ${JSON.stringify(input.memory ?? emptyMemory())}::jsonb, ${input.nextAction ?? null}, ${input.nextActionAt ?? null}::timestamptz)
      ON CONFLICT DO NOTHING
      RETURNING ${COLS}`);
    if (inserted[0]) return { agent: toAgent(inserted[0]), created: true };
    const existing = await this.q(sql`SELECT ${COLS} FROM resource_agents WHERE case_id = ${input.caseId}::uuid AND resource_key = ${input.resourceKey}`);
    if (existing[0]) return { agent: toAgent(existing[0]), created: false };
    // The contact already has an agent under another key (should not happen): return that one.
    const byContact = input.contactId ? await this.byContact(input.contactId) : null;
    if (byContact) return { agent: byContact, created: false };
    throw new Error('resource agent upsert conflict');
  }
  async get(id: string) { return (await this.q(sql`SELECT ${COLS} FROM resource_agents WHERE id = ${id}::uuid`)).map(toAgent)[0] ?? null; }
  async byContact(contactId: string) { return (await this.q(sql`SELECT ${COLS} FROM resource_agents WHERE contact_id = ${contactId}::uuid`)).map(toAgent)[0] ?? null; }
  async byInbox(inboxId: string) { return (await this.q(sql`SELECT ${COLS} FROM resource_agents WHERE inbox_mode = 'own' AND inbox_id = ${inboxId} LIMIT 1`)).map(toAgent)[0] ?? null; }
  async listByCase(caseId: string) { return (await this.q(sql`SELECT ${COLS} FROM resource_agents WHERE case_id = ${caseId}::uuid ORDER BY created_at, resource_key`)).map(toAgent); }
  async update(id: string, patch: AgentPatch) {
    const sets = (Object.keys(patch) as (keyof AgentPatch)[]).filter(k => PATCH_COLUMNS[k]).map(k => {
      const col = PATCH_COLUMNS[k];
      const v = patch[k];
      if (JSON_COLS.has(col)) return sql`${sql.raw(col)} = ${JSON.stringify(v)}::jsonb`;
      if (TIME_COLS.has(col)) return sql`${sql.raw(col)} = ${v ?? null}::timestamptz`;
      if (col === 'contact_id') return sql`contact_id = ${v ?? null}::uuid`;
      return sql`${sql.raw(col)} = ${v ?? null}`;
    });
    if (!sets.length) return;
    await this.q(sql`UPDATE resource_agents SET ${sql.join(sets, sql`, `)} WHERE id = ${id}::uuid`);
  }
  async acquireLease(id: string, owner: string, now: Date, ms: number) {
    const rows = await this.q(sql`
      UPDATE resource_agents SET lease_owner = ${owner}, lease_until = ${new Date(now.getTime() + ms).toISOString()}::timestamptz
      WHERE id = ${id}::uuid AND (lease_until IS NULL OR lease_until < ${now.toISOString()}::timestamptz)
      RETURNING id`);
    return rows.length === 1;
  }
  async releaseLease(id: string, owner: string) {
    await this.q(sql`UPDATE resource_agents SET lease_owner = NULL, lease_until = NULL WHERE id = ${id}::uuid AND lease_owner = ${owner}`);
  }
  async due(now: Date, limit: number) {
    const rows = await this.q(sql`
      SELECT id FROM resource_agents
      WHERE next_action_at IS NOT NULL AND next_action_at <= ${now.toISOString()}::timestamptz AND state <> 'done'
        AND (lease_until IS NULL OR lease_until < ${now.toISOString()}::timestamptz)
      ORDER BY next_action_at LIMIT ${limit}`);
    return rows.map(r => String(r.id));
  }
  async appendEvent(e: Omit<AgentEvent, 'id' | 'createdAt'> & { createdAt?: string }) {
    const rows = await this.q(sql`
      INSERT INTO agent_events (agent_id, case_id, kind, trigger, reason, action, result, data)
      VALUES (${e.agentId}::uuid, ${e.caseId}::uuid, ${e.kind}, ${e.trigger}, ${e.reason}, ${e.action}, ${e.result}, ${e.data ? JSON.stringify(e.data) : null}::jsonb)
      RETURNING id, agent_id, case_id, kind, trigger, reason, action, result, data, created_at`);
    return toEvent(rows[0]);
  }
  async events(agentId: string, limit: number) {
    return (await this.q(sql`SELECT id, agent_id, case_id, kind, trigger, reason, action, result, data, created_at FROM agent_events WHERE agent_id = ${agentId}::uuid ORDER BY created_at DESC LIMIT ${limit}`)).map(toEvent);
  }
}

let shared: AgentStore | null = null;
export function getAgentStore(): AgentStore {
  shared ??= process.env.DATABASE_URL ? new PostgresAgentStore() : new MemoryAgentStore();
  return shared;
}
export function setAgentStoreForTests(s: AgentStore | null): void { shared = s; }
