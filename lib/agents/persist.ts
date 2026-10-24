import { ingestEvidence } from '@/lib/case-docs/hooks';
import type { DocumentStore } from '@/lib/case-docs/store';
import { eq, inArray } from "drizzle-orm";
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

export interface Persist {
  /** Replace the case's candidates with these (re-runs overwrite), upserting resources + evidence. */
  saveResults(caseId: string, entries: readonly RankedEntry[]): Promise<void>;
  getShortlist(caseId: string): Promise<ShortlistItem[]>;
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
export class MemoryPersist implements Persist {
  constructor(private readonly documents?: DocumentStore) {}
  private readonly byCase = new Map<string, ShortlistItem[]>();
  /** Every resource seen, by canonical id (mirrors the entity tables). */
  readonly resources = new Map<string, Resource>();

  async saveResults(caseId: string, entries: readonly RankedEntry[]): Promise<void> {
    for (const e of entries) this.resources.set(e.record.resource.id, e.record.resource);
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
}

type Db = ReturnType<typeof getDb>;

/** Drizzle/Neon implementation. neon-http has no transactions, so writes are ordered idempotent upserts. */
export class DbPersist implements Persist {
  constructor(private readonly db: Db = getDb(), private readonly documents?: DocumentStore) {}

  async saveResults(caseId: string, entries: readonly RankedEntry[]): Promise<void> {
    const { db } = this;
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

    for (const { record } of entries) {
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
        };
        const set = { name: values.name, credentials: values.credentials, specialty: values.specialty, institutionId, verified: values.verified };
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

    for (const { record } of entries) {
      const targetId = idMap.get(record.resource.id) ?? record.resource.id;
      for (const e of record.evidence) {
        await db
          .insert(evidenceTable)
          .values({
            id: e.id,
            targetKind: record.resource.kind,
            targetId,
            claimType: e.claimType,
            claim: e.claim,
            sourceUrl: e.sourceUrl,
            sourceKind: e.sourceKind,
            fetchedAt: new Date(e.fetchedAt),
          })
          .onConflictDoUpdate({ target: evidenceTable.id, set: { targetId, fetchedAt: new Date(e.fetchedAt) } });
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
      .where(inArray(evidenceTable.targetId, cands.map((c) => c.targetId)));

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
}
