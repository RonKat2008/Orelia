import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentRuns, coordinationRecords } from "@/db/schema";
import type { ValidatedCuration } from "./curator";
import type { RankedEntry, ResourceKind } from "./persist";

export type CurationTier = "best" | "good" | "backup" | "exclude";
export interface TierReason {
  text: string;
  evidenceIds: string[];
}

export interface StoredCuration {
  /** Keyed `${targetKind}:${targetId}`. Memory store: canonical ids (same as MemoryPersist). Db store: REAL ids. */
  byTarget: Map<string, { tier: CurationTier; tierReasons: TierReason[] }>;
  summary: string | null;
  /** `${targetKind}:${targetId}` keys (same id space as byTarget) of the suggested picks, best first, max 5. */
  suggested: string[];
}

export interface CurationStore {
  save(caseId: string, ranked: readonly RankedEntry[], curation: ValidatedCuration): Promise<void>;
  load(caseId: string): Promise<StoredCuration | null>;
}

/** Legacy: older cases kept the curation summary on a 'curator' agent_runs row (read only, never written now). */
export const CURATOR_RUN_AGENT = "curator";
/** Case-level curation summary + the curator/judge's own suggested picks (coordination_records kind/key). */
export const CURATION_KIND = "curation";
const CURATION_KEY = "current";
export const MAX_SUGGESTED = 5;
const KIND_ORDER: readonly ResourceKind[] = ["expert", "institution", "trial", "organization"];

export const curationKey = (kind: string, id: string) => `${kind}:${id}`;

/** Best-tier picks ordered by kind (expert, institution, trial, organization) then rank. */
export function computeSuggested(
  ranked: readonly RankedEntry[],
  tierOf: (kind: string, id: string) => string | undefined,
  idOf: (e: RankedEntry) => string = (e) => e.record.resource.id,
): string[] {
  return ranked
    .filter((e) => tierOf(e.record.resource.kind, idOf(e)) === "best")
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.record.resource.kind) - KIND_ORDER.indexOf(b.record.resource.kind) || a.rank - b.rank,
    )
    .slice(0, MAX_SUGGESTED)
    .map((e) => curationKey(e.record.resource.kind, idOf(e)));
}

export class MemoryCurationStore implements CurationStore {
  private readonly byCase = new Map<string, StoredCuration>();

  async save(caseId: string, ranked: readonly RankedEntry[], curation: ValidatedCuration): Promise<void> {
    const byTarget: StoredCuration["byTarget"] = new Map();
    for (const t of curation.tiers) {
      byTarget.set(curationKey(t.kind, t.candidateId), { tier: t.tier, tierReasons: t.reasons.map((r) => ({ text: r.text, evidenceIds: [...r.evidenceIds] })) });
    }
    // The curator/judge's own suggested list (already ordered); never an excluded candidate.
    const suggested = curation.suggested
      .map((id) => ranked.find((e) => e.record.resource.id === id))
      .filter((e): e is RankedEntry => !!e && byTarget.get(curationKey(e.record.resource.kind, e.record.resource.id))?.tier !== "exclude")
      .map((e) => curationKey(e.record.resource.kind, e.record.resource.id))
      .slice(0, MAX_SUGGESTED);
    this.byCase.set(caseId, { byTarget, summary: curation.summary || null, suggested });
  }

  async load(caseId: string): Promise<StoredCuration | null> {
    return this.byCase.get(caseId) ?? null;
  }
}

type Db = ReturnType<typeof getDb>;

/**
 * Persistence: tiers live on case_candidates (tier, tier_reasons columns, written via raw SQL so this file does not
 * depend on schema.ts types). The case-level summary and the suggested picks (real ids, in the judge's order) live in
 * coordination_records kind "curation". Cases saved before that fall back to the legacy 'curator' agent_runs summary
 * and best-tier suggestions recomputed from rank.
 */
export class DbCurationStore implements CurationStore {
  constructor(private readonly db: Db = getDb()) {}

  private async realId(kind: ResourceKind, e: RankedEntry | undefined, canonical: string): Promise<string> {
    const r = e?.record.resource;
    if (r?.kind === "expert" && r.npi) {
      const rows = await this.db.execute(sql`SELECT id FROM experts WHERE npi = ${r.npi} LIMIT 1`);
      return firstId(rows) ?? canonical;
    }
    if (r?.kind === "trial") {
      const rows = await this.db.execute(sql`SELECT id FROM trials WHERE nct_id = ${r.nctId} LIMIT 1`);
      return firstId(rows) ?? canonical;
    }
    void kind;
    return canonical;
  }

  async save(caseId: string, ranked: readonly RankedEntry[], curation: ValidatedCuration): Promise<void> {
    const byId = new Map(ranked.map((e) => [curationKey(e.record.resource.kind, e.record.resource.id), e]));
    const realKeys = new Map<string, string>();
    for (const t of curation.tiers) {
      const entry = byId.get(curationKey(t.kind, t.candidateId));
      const targetId = await this.realId(t.kind, entry, t.candidateId);
      if (t.tier !== "exclude") realKeys.set(t.candidateId, curationKey(t.kind, targetId));
      await this.db.execute(sql`
        UPDATE case_candidates
        SET tier = ${t.tier}, tier_reasons = ${JSON.stringify(t.reasons)}::jsonb
        WHERE case_id = ${caseId} AND target_kind = ${t.kind} AND target_id = ${targetId}
      `);
    }
    const suggested = curation.suggested.flatMap((id) => realKeys.get(id) ?? []).slice(0, MAX_SUGGESTED);
    const data = { summary: curation.summary, suggested, source: curation.source };
    await this.db
      .insert(coordinationRecords)
      .values({ caseId, kind: CURATION_KIND, key: CURATION_KEY, data })
      .onConflictDoUpdate({ target: [coordinationRecords.caseId, coordinationRecords.kind, coordinationRecords.key], set: { data, updatedAt: new Date() } });
  }

  async load(caseId: string): Promise<StoredCuration | null> {
    const res = await this.db.execute(sql`
      SELECT target_kind, target_id, rank, tier, tier_reasons
      FROM case_candidates WHERE case_id = ${caseId} AND tier IS NOT NULL
    `);
    const rows = rowsOf(res) as Array<{ target_kind: ResourceKind; target_id: string; rank: number | null; tier: CurationTier; tier_reasons: TierReason[] | null }>;
    if (rows.length === 0) return null;
    const byTarget: StoredCuration["byTarget"] = new Map();
    for (const r of rows) byTarget.set(curationKey(r.target_kind, r.target_id), { tier: r.tier, tierReasons: r.tier_reasons ?? [] });
    const suggested = rows
      .filter((r) => r.tier === "best")
      .sort((a, b) => KIND_ORDER.indexOf(a.target_kind) - KIND_ORDER.indexOf(b.target_kind) || (a.rank ?? 0) - (b.rank ?? 0))
      .slice(0, MAX_SUGGESTED)
      .map((r) => curationKey(r.target_kind, r.target_id));
    const [record] = await this.db
      .select({ data: coordinationRecords.data })
      .from(coordinationRecords)
      .where(and(eq(coordinationRecords.caseId, caseId), eq(coordinationRecords.kind, CURATION_KIND), eq(coordinationRecords.key, CURATION_KEY)))
      .limit(1);
    const stored = record?.data as { summary?: unknown; suggested?: unknown } | undefined;
    if (stored) {
      const picks = Array.isArray(stored.suggested) ? stored.suggested.filter((k): k is string => typeof k === "string" && byTarget.has(k) && byTarget.get(k)?.tier !== "exclude") : [];
      return { byTarget, summary: typeof stored.summary === "string" && stored.summary ? stored.summary : null, suggested: picks.slice(0, MAX_SUGGESTED) };
    }
    // Legacy cases: summary on the old 'curator' agent_runs row; suggestions recomputed from best tiers.
    const run = await this.db
      .select({ outputSummary: agentRuns.outputSummary })
      .from(agentRuns)
      .where(and(eq(agentRuns.caseId, caseId), eq(agentRuns.agent, CURATOR_RUN_AGENT)))
      .limit(1);
    return { byTarget, summary: run[0]?.outputSummary ?? null, suggested };
  }
}

function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}
function firstId(res: unknown): string | null {
  const id = rowsOf(res)[0]?.id;
  return typeof id === "string" ? id : null;
}

const g = globalThis as { __wayfinderCurations?: CurationStore };

/** Postgres when DATABASE_URL is set (mirrors getServices); otherwise a process-local singleton. */
export function getCurationStore(): CurationStore {
  g.__wayfinderCurations ??= process.env.DATABASE_URL ? new DbCurationStore() : new MemoryCurationStore();
  return g.__wayfinderCurations;
}
