import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { calls, contacts } from "@/db/schema";
import { hasDatabase, isoOrNull, queryRows, tableExists, truncate } from "../db";
import { parseTranscript } from "../transcript";
import type { ActivityEvent, ActivitySource, CallLiveSource, CallRecord, CallTurn, LiveCall, LiveCallStatus } from "../types";

/** The shape of a `calls` row this source needs. */
export interface CallRow {
  id: string;
  contactId: string;
  approvedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  transcript: string | null;
  outcome: string | null;
}

/** Vapi status vocabulary -> console status. Unknown strings return null so callers can fall back. */
export function normalizeCallStatus(status: string | null | undefined): LiveCallStatus | null {
  switch ((status ?? "").toLowerCase()) {
    case "queued": case "scheduled": return "queued";
    case "ringing": return "ringing";
    case "in-progress": case "in_progress": case "forwarding": case "connected": return "connected";
    case "ended": return "ended";
    default: return null;
  }
}

/** Implementation A status: only what the `calls` row can tell us. */
export function deriveCallStatus(row: Pick<CallRow, "startedAt" | "endedAt" | "outcome" | "transcript">): LiveCallStatus {
  if (row.endedAt || row.outcome) return "ended";
  if (!row.startedAt) return "queued";
  return row.transcript?.trim() ? "connected" : "ringing";
}

/** Turns for a row without per-line timestamps: spaced 1 ms apart from the call start so ordering is deterministic. */
function stampTurns(turns: CallTurn[], startedAt: string | null): CallTurn[] {
  if (!startedAt) return turns;
  const base = Date.parse(startedAt);
  return turns.map((t) => ({ ...t, at: t.at ?? new Date(base + t.seq).toISOString() }));
}

/** Implementation A: map `calls` rows (no provider live state). Pure. */
export function recordsFromRows(rows: CallRow[]): CallRecord[] {
  return rows.map((row) => {
    const startedAt = isoOrNull(row.startedAt);
    const status = deriveCallStatus(row);
    return {
      id: row.id,
      contactId: row.contactId,
      provider: null,
      status,
      live: status !== "ended",
      endedReason: null,
      summary: null,
      outcome: row.outcome,
      startedAt,
      endedAt: isoOrNull(row.endedAt),
      queuedAt: isoOrNull(row.approvedAt),
      turns: stampTurns(parseTranscript(row.transcript), startedAt),
    };
  });
}

export interface LiveOverlay {
  callId: string;
  provider: string | null;
  status: string | null;
  endedReason: string | null;
  summary: string | null;
  listenUrl: string | null;
}
export interface TurnRow {
  callId: string;
  seq: number;
  role: string;
  text: string;
  spokenAt: Date | string | null;
}

/** Implementation B: overlay call_live / call_turns on the A records. Pure. */
export function overlayLive(records: CallRecord[], live: LiveOverlay[], turns: TurnRow[]): CallRecord[] {
  const liveById = new Map(live.map((l) => [l.callId, l]));
  const turnsById = new Map<string, TurnRow[]>();
  for (const t of turns) turnsById.set(t.callId, [...(turnsById.get(t.callId) ?? []), t]);
  return records.map((rec) => {
    const l = liveById.get(rec.id);
    const t = turnsById.get(rec.id);
    if (!l && !t) return rec;
    const status = normalizeCallStatus(l?.status) ?? rec.status;
    const merged: CallRecord = {
      ...rec,
      provider: l?.provider === "vapi" || l?.provider === "vapi-web" ? l.provider : rec.provider,
      status,
      live: status !== "ended",
      endedReason: l?.endedReason ?? rec.endedReason,
      summary: l?.summary ?? rec.summary,
    };
    if (l?.listenUrl) merged.listenUrl = l.listenUrl;
    if (t && t.length > 0) {
      merged.turns = [...t].sort((a, b) => a.seq - b.seq).map((x) => ({ seq: x.seq, role: x.role === "ai" ? "ai" as const : "human" as const, text: x.text, at: isoOrNull(x.spokenAt) }));
    }
    return merged;
  });
}

/** Pure: pick B when both tables exist, else A. */
export function chooseCallLiveSource(tables: { callLive: boolean; callTurns: boolean }, a: CallLiveSource, b: CallLiveSource): CallLiveSource {
  return tables.callLive && tables.callTurns ? b : a;
}

async function loadCallRows(caseId: string): Promise<CallRow[]> {
  const people = await getDb().select({ id: contacts.id }).from(contacts).where(eq(contacts.caseId, caseId));
  if (people.length === 0) return [];
  return getDb()
    .select({ id: calls.id, contactId: calls.contactId, approvedAt: calls.approvedAt, startedAt: calls.startedAt, endedAt: calls.endedAt, transcript: calls.transcript, outcome: calls.outcome })
    .from(calls)
    .where(inArray(calls.contactId, people.map((p) => p.id)));
}

export const callsRowSource: CallLiveSource = {
  name: "calls-row",
  async load(caseId) {
    return hasDatabase() ? recordsFromRows(await loadCallRows(caseId)) : [];
  },
};

export const callLiveTablesSource: CallLiveSource = {
  name: "call-live",
  async load(caseId) {
    const base = await callsRowSource.load(caseId);
    if (base.length === 0) return base;
    const ids = base.map((r) => r.id);
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    try {
      const [live, turns] = await Promise.all([
        queryRows<{ call_id: string; provider: string | null; status: string | null; ended_reason: string | null; summary: string | null; listen_url: string | null }>(
          sql`select call_id, provider, status, ended_reason, summary, listen_url from public.call_live where call_id in (${idList})`),
        queryRows<{ call_id: string; seq: string | number; role: string; text: string; spoken_at: Date | string | null }>(
          sql`select call_id, seq, role, text, spoken_at from public.call_turns where call_id in (${idList}) order by call_id, seq`),
      ]);
      return overlayLive(
        base,
        live.map((l) => ({ callId: l.call_id, provider: l.provider, status: l.status, endedReason: l.ended_reason, summary: l.summary, listenUrl: l.listen_url })),
        turns.map((t) => ({ callId: t.call_id, seq: Number(t.seq), role: t.role, text: t.text, spokenAt: t.spoken_at })),
      );
    } catch {
      return base;
    }
  },
};

/** Pure: call records -> timeline events. Never puts listenUrl into events. */
export function callEvents(records: CallRecord[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const r of records) {
    const contactId = r.contactId;
    if (r.queuedAt) out.push({ id: `call:${r.id}:queued`, at: r.queuedAt, kind: "call_queued", contactId, title: "Call queued" });
    if (r.startedAt) out.push({ id: `call:${r.id}:ringing`, at: r.startedAt, kind: "call_ringing", contactId, title: "Call ringing" });
    const firstTurnAt = r.turns.find((t) => t.at)?.at ?? null;
    if (r.status === "connected" || (r.status === "ended" && r.turns.length > 0)) {
      const at = firstTurnAt ?? r.startedAt;
      if (at) out.push({ id: `call:${r.id}:connected`, at, kind: "call_connected", contactId, title: "Call connected" });
    }
    for (const t of r.turns) {
      const at = t.at ?? r.endedAt ?? r.startedAt;
      if (!at) continue;
      out.push({ id: `call:${r.id}:turn:${t.seq}`, at, kind: "call_turn", contactId, title: t.role === "ai" ? "Agent said" : "Callee said", detail: truncate(t.text, 600), meta: { role: t.role } });
    }
    if (r.status === "ended" && r.endedAt) {
      out.push({ id: `call:${r.id}:ended`, at: r.endedAt, kind: "call_ended", contactId, title: r.outcome ? `Call ended: ${r.outcome}` : "Call ended", detail: r.summary ? truncate(r.summary, 600) : undefined, meta: { outcome: r.outcome, reason: r.endedReason } });
    }
  }
  return out;
}

/** Newest call per contact becomes the lane's call. */
export function callLanes(records: CallRecord[]) {
  const latest = new Map<string, CallRecord>();
  for (const r of records) {
    const prev = latest.get(r.contactId);
    if (!prev || (r.startedAt ?? r.queuedAt ?? "") >= (prev.startedAt ?? prev.queuedAt ?? "")) latest.set(r.contactId, r);
  }
  return [...latest.values()].map((record) => {
    const call: LiveCall & { contactId?: string; queuedAt?: string | null } = { ...record };
    delete call.contactId;
    delete call.queuedAt;
    return { contactId: record.contactId, call };
  });
}

export const callsSource: ActivitySource = {
  name: "calls",
  async load(caseId) {
    if (!hasDatabase()) return { events: [] };
    const [callLive, callTurns] = await Promise.all([tableExists("call_live"), tableExists("call_turns")]);
    const records = await chooseCallLiveSource({ callLive, callTurns }, callsRowSource, callLiveTablesSource).load(caseId);
    return { events: callEvents(records), lanes: callLanes(records) };
  },
};
