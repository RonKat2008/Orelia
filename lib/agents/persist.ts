import { ingestEvidence } from '@/lib/case-docs/hooks';
import type { DocumentStore } from '@/lib/case-docs/store';
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  caseCandidates,
  evidence as evidenceTable,
  experts,
  institutions,
  organizations,
  trials,
} from "@/db/schema";
import type { Resource, ScoreBreakdownItem } from "@/lib/contracts";
import type { EvidenceWithId, VerifiedRecord } from "./verifier";

export type ResourceKind = Resource["kind"];

export interface RankedEntry {
  record: VerifiedRecord;
  score: number;
  rank: number;
  breakdown: ScoreBreakdownItem[];
}

export interface ShortlistEvidence {
  id: string;
  claimType: string;
  claim: string;
  sourceUrl: string;
  sourceKind: string;
  fetchedAt: string;
}

export interface ShortlistItem {
  targetKind: ResourceKind;
  targetId: string;
  name: string;
  rank: number;
  score: number;
  selected: boolean;
  breakdown: ScoreBreakdownItem[];
  evidence: ShortlistEvidence[];
}

/** Row identity and resource fields the shortlist page needs beyond the ranked item. */
export interface ShortlistMeta {
  targetKind: ResourceKind;
  targetId: string;
  caseCandidateId: string;
  nctId: string | null;
  organizationKind: "advocacy" | "financial_aid" | "travel_aid" | null;
}

/** An expert with case-scoped verified evidence: shortlisted, or kept as research below the shortlist threshold. */
export interface CaseExpert {
  id: string;
  name: string;
  npi: string | null;
  profile?: { paperCount?: number; recentPaperCount?: number; affiliation?: string; state?: string };
  evidence: ShortlistEvidence[];
}

export interface Persist {
  /**
   * Replace the case's candidates with these (re-runs overwrite), upserting resources + evidence.
   * `research` holds verified experts that are NOT eligible for the shortlist: their resource and evidence rows are
   * saved for the read-only Experts trace, but they get no candidate row and are not ingested into outreach docs.
   */
  saveResults(caseId: string, entries: readonly RankedEntry[], research?: readonly VerifiedRecord[]): Promise<void>;
  getShortlist(caseId: string): Promise<ShortlistItem[]>;
  getShortlistMeta(caseId: string): Promise<ShortlistMeta[]>;
  /** Every expert (shortlisted or research-only) with evidence saved for this case. */
  getCaseExperts(caseId: string): Promise<CaseExpert[]>;
  /**
   * Add code-stamped evidence rows (affiliations, contact points) to resources already saved for this case, without
   * re-running research. Existing rows (same id) are left untouched. Returns how many rows were new.
   */
  appendEvidence(caseId: string, additions: readonly EvidenceAddition[]): Promise<number>;
}

export interface EvidenceAddition {
  targetKind: ResourceKind;
  targetId: string;
  evidence: readonly ShortlistEvidence[];
}

/** Research-only records: experts that are not among the ranked entries. */
function researchExperts(entries: readonly RankedEntry[], research: readonly VerifiedRecord[] = []): VerifiedRecord[] {
  const ranked = new Set(entries.map((e) => e.record.resource.id));
  return research.filter((r) => r.resource.kind === "expert" && !ranked.has(r.resource.id));
}

function toCaseExpert(record: VerifiedRecord): CaseExpert | null {
  const r = record.resource;
  if (r.kind !== "expert") return null;
  return {
    id: r.id,
    name: r.name,
    npi: r.npi ?? null,
    ...(r.profile ? { profile: { ...r.profile } } : {}),
    evidence: record.evidence.map(toShortlistEvidence),
  };
}

export function resourceName(r: Resource): string {
  return r.kind === "trial" ? r.title : r.name;
}

function toShortlistEvidence(e: EvidenceWithId): ShortlistEvidence {
  return {
    id: e.id,
    claimType: e.claimType,
    claim: e.claim,
    sourceUrl: e.sourceUrl,
    sourceKind: e.sourceKind,
    fetchedAt: e.fetchedAt,
  };
}

/** In-memory implementation for tests and offline demo. */
function metaFor(resource: Resource, caseCandidateId: string): ShortlistMeta {
  return {
    targetKind: resource.kind,
    targetId: resource.id,
    caseCandidateId,
    nctId: resource.kind === "trial" ? resource.nctId : null,
    organizationKind: resource.kind === "organization" ? (resource.organizationKind ?? null) : null,
  };
}

export class MemoryPersist implements Persist {
  constructor(private readonly documents?: DocumentStore) {}
  private readonly byCase = new Map<string, ShortlistItem[]>();
  private readonly metaByCase = new Map<string, ShortlistMeta[]>();
  private readonly expertsByCase = new Map<string, CaseExpert[]>();
  /** Every resource seen, by canonical id (mirrors the entity tables). */
  readonly resources = new Map<string, Resource>();

  async saveResults(caseId: string, entries: readonly RankedEntry[], research?: readonly VerifiedRecord[]): Promise<void> {
    const extra = researchExperts(entries, research);
    for (const e of entries) this.resources.set(e.record.resource.id, e.record.resource);
    for (const r of extra) this.resources.set(r.resource.id, r.resource);
    this.expertsByCase.set(caseId, [...entries.map((e) => e.record), ...extra].flatMap((r) => toCaseExpert(r) ?? []));
    this.metaByCase.set(caseId, entries.map((e) => metaFor(e.record.resource, crypto.randomUUID())));
    this.byCase.set(
      caseId,
      entries.map((e) => ({
        targetKind: e.record.resource.kind,
        targetId: e.record.resource.id,
        name: resourceName(e.record.resource),
        rank: e.rank,
        score: e.score,
        selected: false,
        breakdown: e.breakdown,
        evidence: e.record.evidence.map(toShortlistEvidence),
      })),
    );
    await ingestEvidence(caseId, entries.flatMap(e => e.record.evidence), this.documents);
  }

  async getShortlist(caseId: string): Promise<ShortlistItem[]> {
    return [...(this.byCase.get(caseId) ?? [])];
  }

  async getShortlistMeta(caseId: string): Promise<ShortlistMeta[]> {
    return [...(this.metaByCase.get(caseId) ?? [])];
  }

  async getCaseExperts(caseId: string): Promise<CaseExpert[]> {
    return (this.expertsByCase.get(caseId) ?? []).map((e) => structuredClone(e));
  }

  async appendEvidence(caseId: string, additions: readonly EvidenceAddition[]): Promise<number> {
    let added = 0;
    const merge = (have: ShortlistEvidence[], rows: readonly ShortlistEvidence[]) => {
      const ids = new Set(have.map((e) => e.id));
      const fresh = rows.filter((r) => !ids.has(r.id));
      return { next: [...have, ...fresh.map((r) => ({ ...r }))], fresh: fresh.length };
    };
    for (const a of additions) {
      let counted = 0;
      if (a.targetKind === "expert") {
        this.expertsByCase.set(caseId, (this.expertsByCase.get(caseId) ?? []).map((x) => {
          if (x.id !== a.targetId) return x;
          const m = merge(x.evidence, a.evidence);
          counted = Math.max(counted, m.fresh);
          return { ...x, evidence: m.next };
        }));
      }
      this.byCase.set(caseId, (this.byCase.get(caseId) ?? []).map((i) => {
        if (i.targetKind !== a.targetKind || i.targetId !== a.targetId) return i;
        const m = merge(i.evidence, a.evidence);
        counted = Math.max(counted, m.fresh);
        return { ...i, evidence: m.next };
      }));
      added += counted;
    }
    return added;
  }
}

type Db = ReturnType<typeof getDb>;

/** Drizzle/Neon implementation. neon-http has no transactions, so writes are ordered idempotent upserts. */
export class DbPersist implements Persist {
  constructor(private readonly db: Db = getDb(), private readonly documents?: DocumentStore) {}

  async saveResults(caseId: string, entries: readonly RankedEntry[], research?: readonly VerifiedRecord[]): Promise<void> {
    const { db } = this;
    const records = [...entries.map((e) => e.record), ...researchExperts(entries, research)];
    // canonical (verifier) id -> real DB id (differs only when an NPI / NCT row already existed)
    const idMap = new Map<string, string>();

    const insts = entries.filter((e) => e.record.resource.kind === "institution");
    for (const { record } of insts) {
      const r = record.resource;
      if (r.kind !== "institution") continue;
      await db
        .insert(institutions)
        .values({
          id: r.id,
          name: r.name,
          kind: r.institutionKind ?? "hospital",
          city: r.city ?? null,
          state: r.state ?? null,
          nciDesignated: record.evidence.some((e) => e.sourceKind === "nci"),
        })
        .onConflictDoUpdate({
          target: institutions.id,
          set: { name: r.name, city: r.city ?? null, state: r.state ?? null },
        });
      idMap.set(r.id, r.id);
    }

    for (const record of records) {
      const r = record.resource;
      if (r.kind === "expert") {
        const institutionId = r.institutionId ? (idMap.get(r.institutionId) ?? null) : null;
        const values = {
          id: r.id,
          npi: r.npi ?? null,
          name: r.name,
          credentials: r.credentials ?? null,
          specialty: r.specialty ?? null,
          institutionId,
          verified: r.verified === true,
          diseasePaperCount: r.profile?.paperCount ?? null,
          recentPaperCount: r.profile?.recentPaperCount ?? null,
        };
        const set = {
          name: values.name, credentials: values.credentials, specialty: values.specialty, institutionId, verified: values.verified,
          diseasePaperCount: values.diseasePaperCount, recentPaperCount: values.recentPaperCount,
        };
        const [row] = await db
          .insert(experts)
          .values(values)
          .onConflictDoUpdate({ target: values.npi ? experts.npi : experts.id, set })
          .returning({ id: experts.id });
        idMap.set(r.id, row?.id ?? r.id);
      } else if (r.kind === "trial") {
        const [row] = await db
          .insert(trials)
          .values({ id: r.id, nctId: r.nctId, title: r.title, status: r.status ?? null })
          .onConflictDoUpdate({ target: trials.nctId, set: { title: r.title, status: r.status ?? null } })
          .returning({ id: trials.id });
        idMap.set(r.id, row?.id ?? r.id);
      } else if (r.kind === "organization") {
        await db
          .insert(organizations)
          .values({ id: r.id, kind: r.organizationKind ?? "advocacy", name: r.name, url: r.url ?? null })
          .onConflictDoUpdate({ target: organizations.id, set: { name: r.name, url: r.url ?? null } });
        idMap.set(r.id, r.id);
      }
    }

    for (const record of records) {
      const targetId = idMap.get(record.resource.id) ?? record.resource.id;
      for (const e of record.evidence) {
        await db
          .insert(evidenceTable)
          .values({
            id: e.id,
            caseId,
            targetKind: record.resource.kind,
            targetId,
            claimType: e.claimType,
            claim: e.claim,
            sourceUrl: e.sourceUrl,
            sourceKind: e.sourceKind,
            fetchedAt: new Date(e.fetchedAt),
          })
          .onConflictDoUpdate({ target: [evidenceTable.caseId, evidenceTable.id], set: { targetId, fetchedAt: new Date(e.fetchedAt) } });
      }
    }

    await db.delete(caseCandidates).where(eq(caseCandidates.caseId, caseId));
    if (entries.length > 0) {
      await db.insert(caseCandidates).values(
        entries.map((e) => ({
          caseId,
          targetKind: e.record.resource.kind,
          targetId: idMap.get(e.record.resource.id) ?? e.record.resource.id,
          rank: e.rank,
          score: Math.round(e.score),
          scoreBreakdown: e.breakdown,
        })),
      );
    }
    await ingestEvidence(caseId, entries.flatMap(e => e.record.evidence), this.documents);
  }

  async getShortlist(caseId: string): Promise<ShortlistItem[]> {
    const { db } = this;
    const cands = await db.select().from(caseCandidates).where(eq(caseCandidates.caseId, caseId));
    if (cands.length === 0) return [];

    const idsOf = (k: ResourceKind) => cands.filter((c) => c.targetKind === k).map((c) => c.targetId);
    const names = new Map<string, string>();
    const [ex, ins, tr, org] = [idsOf("expert"), idsOf("institution"), idsOf("trial"), idsOf("organization")];
    if (ex.length) for (const r of await db.select().from(experts).where(inArray(experts.id, ex))) names.set(r.id, r.name);
    if (ins.length) for (const r of await db.select().from(institutions).where(inArray(institutions.id, ins))) names.set(r.id, r.name);
    if (tr.length) for (const r of await db.select().from(trials).where(inArray(trials.id, tr))) names.set(r.id, r.title);
    if (org.length) for (const r of await db.select().from(organizations).where(inArray(organizations.id, org))) names.set(r.id, r.name);

    const evRows = await db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.caseId, caseId), inArray(evidenceTable.targetId, cands.map((c) => c.targetId))));

    return cands
      .map((c) => ({
        targetKind: c.targetKind,
        targetId: c.targetId,
        name: names.get(c.targetId) ?? "(unknown)",
        rank: c.rank ?? 0,
        score: c.score ?? 0,
        selected: c.selected,
        breakdown: c.scoreBreakdown ?? [],
        evidence: evRows
          .filter((e) => e.targetId === c.targetId && e.targetKind === c.targetKind)
          .map((e) => ({
            id: e.id,
            claimType: e.claimType,
            claim: e.claim,
            sourceUrl: e.sourceUrl,
            sourceKind: e.sourceKind,
            fetchedAt: e.fetchedAt.toISOString(),
          })),
      }))
      .sort((a, b) => a.targetKind.localeCompare(b.targetKind) || a.rank - b.rank);
  }

  async getShortlistMeta(caseId: string): Promise<ShortlistMeta[]> {
    const { db } = this;
    const cands = await db.select().from(caseCandidates).where(eq(caseCandidates.caseId, caseId));
    if (cands.length === 0) return [];
    const trialIds = cands.filter((c) => c.targetKind === "trial").map((c) => c.targetId);
    const orgIds = cands.filter((c) => c.targetKind === "organization").map((c) => c.targetId);
    const nct = new Map<string, string>();
    const kinds = new Map<string, ShortlistMeta["organizationKind"]>();
    if (trialIds.length) {
      for (const row of await db.select({ id: trials.id, nctId: trials.nctId }).from(trials).where(inArray(trials.id, trialIds))) {
        nct.set(row.id, row.nctId);
      }
    }
    if (orgIds.length) {
      for (const row of await db.select({ id: organizations.id, kind: organizations.kind }).from(organizations).where(inArray(organizations.id, orgIds))) {
        kinds.set(row.id, row.kind);
      }
    }
    return cands.map((c) => ({
      targetKind: c.targetKind,
      targetId: c.targetId,
      caseCandidateId: c.id,
      nctId: c.targetKind === "trial" ? (nct.get(c.targetId) ?? null) : null,
      organizationKind: c.targetKind === "organization" ? (kinds.get(c.targetId) ?? null) : null,
    }));
  }

  async appendEvidence(caseId: string, additions: readonly EvidenceAddition[]): Promise<number> {
    const rows = additions.flatMap((a) => a.evidence.map((e) => ({
      id: e.id,
      caseId,
      targetKind: a.targetKind,
      targetId: a.targetId,
      claimType: e.claimType,
      claim: e.claim,
      sourceUrl: e.sourceUrl,
      sourceKind: e.sourceKind as typeof evidenceTable.$inferInsert.sourceKind,
      fetchedAt: new Date(e.fetchedAt),
    })));
    if (rows.length === 0) return 0;
    const inserted = await this.db.insert(evidenceTable).values(rows).onConflictDoNothing({ target: [evidenceTable.caseId, evidenceTable.id] }).returning({ id: evidenceTable.id });
    return inserted.length;
  }

  async getCaseExperts(caseId: string): Promise<CaseExpert[]> {
    const { db } = this;
    const evRows = await db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.caseId, caseId), eq(evidenceTable.targetKind, "expert")));
    if (evRows.length === 0) return [];
    const ids = [...new Set(evRows.map((e) => e.targetId))];
    const rows = await db.select().from(experts).where(inArray(experts.id, ids));
    return rows.map((x) => {
      const profile = {
        ...(x.diseasePaperCount != null ? { paperCount: x.diseasePaperCount } : {}),
        ...(x.recentPaperCount != null ? { recentPaperCount: x.recentPaperCount } : {}),
      };
      return {
        id: x.id,
        name: x.name,
        npi: x.npi ?? null,
        ...(Object.keys(profile).length ? { profile } : {}),
        evidence: evRows
          .filter((e) => e.targetId === x.id)
          .map((e) => ({
            id: e.id,
            claimType: e.claimType,
            claim: e.claim,
            sourceUrl: e.sourceUrl,
            sourceKind: e.sourceKind,
            fetchedAt: e.fetchedAt.toISOString(),
          })),
      };
    });
  }
}
