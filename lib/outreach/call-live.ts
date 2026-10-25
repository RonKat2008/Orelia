/**
 * Live call state and transcript turns (Vapi). Webhooks write here as the call happens; the case read endpoint
 * (/api/cases/[id]/calls/live) and its SSE stream read it so the UI can show a call in progress.
 * The listen URL is kept for the judge view only and is never logged.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';

export interface CallKey { providerCallId: string; contactId: string }
export interface LiveTurnInput { seq: number; role: 'ai' | 'human'; text: string; at?: string; dedupeKey: string }
/** 'vapi-web' marks a DEMO browser call (Vapi web call answered by the presenter), 'vapi' a phone call. */
export type LiveProvider = 'vapi' | 'vapi-web';
export interface LiveStateInput { provider: LiveProvider; status?: string; endedReason?: string; summary?: string; listenUrl?: string }

export interface CallLiveStore {
  /** Merges the given fields into the call's live row (missing fields keep their stored value). */
  upsertState(key: CallKey, state: LiveStateInput): Promise<void>;
  /** Inserts turns, skipping any dedupe key already stored. Returns how many were new. */
  appendTurns(key: CallKey, turns: readonly LiveTurnInput[]): Promise<number>;
  countTurns(key: CallKey): Promise<number>;
}

export const LIVE_STATUSES = new Set(['scheduled', 'queued', 'ringing', 'in-progress', 'forwarding']);

export interface LiveTurnView { seq: number; role: 'ai' | 'human'; text: string; at: string | null }
export interface LiveCallView {
  id: string;
  contactId: string;
  provider: string | null;
  status: string | null;
  live: boolean;
  endedReason: string | null;
  summary: string | null;
  startedAt: string | null;
  endedAt: string | null;
  outcome: string | null;
  transcript: string | null;
  turns: LiveTurnView[];
  listenUrl?: string;
}

/** In-process store for tests and the offline journey. */
export function memoryCallLiveStore() {
  const states = new Map<string, LiveStateInput>();
  const turns = new Map<string, LiveTurnInput[]>();
  const keys = new Set<string>();
  const id = (k: CallKey) => `${k.contactId}:${k.providerCallId}`;
  const store: CallLiveStore & { state(k: CallKey): LiveStateInput | undefined; turns(k: CallKey): LiveTurnInput[] } = {
    async upsertState(k, st) {
      const prev = states.get(id(k));
      const defined = Object.fromEntries(Object.entries(st).filter(([, v]) => v !== undefined)) as Partial<LiveStateInput>;
      states.set(id(k), { ...(prev ?? { provider: st.provider }), ...defined } as LiveStateInput);
    },
    async appendTurns(k, list) {
      let added = 0;
      const cur = turns.get(id(k)) ?? [];
      const next = [...cur];
      for (const t of list) {
        if (keys.has(t.dedupeKey)) continue;
        keys.add(t.dedupeKey); next.push(t); added++;
      }
      turns.set(id(k), next.sort((a, b) => a.seq - b.seq));
      return added;
    },
    async countTurns(k) { return (turns.get(id(k)) ?? []).length; },
    state: k => states.get(id(k)),
    turns: k => turns.get(id(k)) ?? [],
  };
  return store;
}

const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : new Date(v).toISOString());

export class PostgresCallLiveStore implements CallLiveStore {
  constructor(private readonly db: () => ReturnType<typeof getDb> = getDb) {}

  private async callRowId(k: CallKey): Promise<string | undefined> {
    const [row] = await this.db().select({ id: s.calls.id }).from(s.calls)
      .where(and(eq(s.calls.providerCallId, k.providerCallId), eq(s.calls.contactId, k.contactId))).limit(1);
    return row?.id;
  }

  async upsertState(k: CallKey, st: LiveStateInput): Promise<void> {
    const callId = await this.callRowId(k);
    if (!callId) return;
    const set = {
      ...(st.status !== undefined ? { status: st.status } : {}),
      ...(st.endedReason !== undefined ? { endedReason: st.endedReason } : {}),
      ...(st.summary !== undefined ? { summary: st.summary } : {}),
      ...(st.listenUrl !== undefined ? { listenUrl: st.listenUrl } : {}),
      updatedAt: sql`now()`,
    };
    await this.db().insert(s.callLive).values({ callId, provider: st.provider, ...set })
      .onConflictDoUpdate({ target: s.callLive.callId, set });
  }

  async appendTurns(k: CallKey, turns: readonly LiveTurnInput[]): Promise<number> {
    if (!turns.length) return 0;
    const callId = await this.callRowId(k);
    if (!callId) return 0;
    const rows = await this.db().insert(s.callTurns).values(turns.map(t => ({
      callId, seq: t.seq, role: t.role, text: t.text, dedupeKey: t.dedupeKey, ...(t.at ? { spokenAt: new Date(t.at) } : {}),
    }))).onConflictDoNothing({ target: s.callTurns.dedupeKey }).returning({ id: s.callTurns.id });
    return rows.length;
  }

  async countTurns(k: CallKey): Promise<number> {
    const callId = await this.callRowId(k);
    if (!callId) return 0;
    const [row] = await this.db().select({ n: sql<number>`count(*)::int` }).from(s.callTurns).where(eq(s.callTurns.callId, callId));
    return Number(row?.n ?? 0);
  }
}

/**
 * Calls of one case with their live state and turns, newest first. `judge` adds the listen URL. Reads only;
 * AgentCall calls (no call_live row) show their stored outcome/transcript and no turns.
 */
export async function loadLiveCalls(caseId: string, opts: { judge?: boolean; db?: () => ReturnType<typeof getDb> } = {}): Promise<LiveCallView[]> {
  const db = (opts.db ?? getDb)();
  const rows = await db.select({
    id: s.calls.id, contactId: s.calls.contactId, startedAt: s.calls.startedAt, endedAt: s.calls.endedAt,
    outcome: s.calls.outcome, transcript: s.calls.transcript,
    provider: s.callLive.provider, status: s.callLive.status, endedReason: s.callLive.endedReason,
    summary: s.callLive.summary, listenUrl: s.callLive.listenUrl,
  }).from(s.calls)
    .innerJoin(s.contacts, eq(s.contacts.id, s.calls.contactId))
    .leftJoin(s.callLive, eq(s.callLive.callId, s.calls.id))
    .where(eq(s.contacts.caseId, caseId))
    .orderBy(desc(s.calls.startedAt))
    .limit(50);
  if (!rows.length) return [];
  const turnRows = await db.select({ callId: s.callTurns.callId, seq: s.callTurns.seq, role: s.callTurns.role, text: s.callTurns.text, at: s.callTurns.spokenAt })
    .from(s.callTurns).where(inArray(s.callTurns.callId, rows.map(r => r.id))).orderBy(asc(s.callTurns.seq));
  const byCall = new Map<string, LiveTurnView[]>();
  for (const t of turnRows) {
    const list = byCall.get(t.callId) ?? [];
    list.push({ seq: Number(t.seq), role: t.role === 'ai' ? 'ai' : 'human', text: t.text, at: iso(t.at) });
    byCall.set(t.callId, list);
  }
  return rows.map(r => toView(r, byCall.get(r.id) ?? [], opts.judge === true));
}

type Row = { id: string; contactId: string; startedAt: Date | null; endedAt: Date | null; outcome: string | null; transcript: string | null; provider: string | null; status: string | null; endedReason: string | null; summary: string | null; listenUrl: string | null };

export function toView(r: Row, turns: LiveTurnView[], judge: boolean): LiveCallView {
  const status = r.status ?? r.outcome ?? null;
  return {
    id: r.id, contactId: r.contactId, provider: r.provider ?? null, status,
    live: !!r.status && LIVE_STATUSES.has(r.status) && !r.endedAt,
    endedReason: r.endedReason ?? null, summary: r.summary ?? null,
    startedAt: iso(r.startedAt), endedAt: iso(r.endedAt), outcome: r.outcome ?? null, transcript: r.transcript ?? null,
    turns,
    ...(judge && r.listenUrl ? { listenUrl: r.listenUrl } : {}),
  };
}
