import type { ExaPort } from "./research/source-ports";
import { deterministicUuid, type EvidenceWithId, type VerifiedRecord, type VerifyOutput } from "./verifier";
import { enrichInstitutions, type EnrichTarget } from "@/lib/contact-finder/enrich";

const DEFAULT_BUDGET_MS = 30_000;

const evidenceKey = (e: { sourceUrl: string; claimType: string; claim: string }) => `${e.sourceUrl}|${e.claimType}|${e.claim}`;

const ORG_KINDS = new Set(["advocacy", "financial_aid", "travel_aid"]);

/** Enrichment targets: kept institutions, and kept advocacy / financial / travel aid organizations (with their own url). */
function targetsOf(kept: readonly VerifiedRecord[]): EnrichTarget[] {
  return kept.flatMap((k): EnrichTarget[] => {
    const r = k.resource;
    if (r.kind === "institution") return [{ targetKind: "institution", targetId: r.id, name: r.name, evidence: k.evidence }];
    if (r.kind === "organization" && r.organizationKind && ORG_KINDS.has(r.organizationKind)) {
      return [{ targetKind: "organization", targetId: r.id, name: r.name, evidence: k.evidence, ...(r.url ? { siteUrl: r.url } : {}) }];
    }
    return [];
  });
}

/**
 * After verification, give kept institutions (no phone, or a phone but no email / online form) and kept aid /
 * advocacy organizations without an email code-stamped contact points from their own site (see
 * lib/contact-finder/enrich). Ids follow the verifier's scheme. Bounded in time; on timeout the targets that already
 * finished are kept, on error the verified output is returned unchanged, so research never fails because of this step.
 */
export async function enrichVerified(verified: VerifyOutput, exa: ExaPort, now: Date, budgetMs = DEFAULT_BUDGET_MS): Promise<VerifyOutput> {
  let targets: EnrichTarget[];
  try { targets = targetsOf(verified.kept); } catch { return verified; }
  if (targets.length === 0) return verified;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });
  // Targets that finished before the budget ran out are kept even when others are still searching.
  const partial = new Map<string, Array<Omit<EvidenceWithId, "id"> & { id: string }>>();
  const done = await Promise.race([
    enrichInstitutions(targets, exa, now.toISOString(), partial).catch(() => null),
    timeout,
  ]).finally(() => clearTimeout(timer));
  const rows = done ?? partial;
  if (!rows || rows.size === 0) return verified;
  try {
    return { ...verified, kept: mergeRows(verified.kept, rows) };
  } catch {
    return verified;
  }
}

function mergeRows(keptIn: readonly VerifiedRecord[], rows: ReadonlyMap<string, ReadonlyArray<Omit<EvidenceWithId, "id"> & { id?: string }>>): VerifiedRecord[] {
  return keptIn.map((k): VerifiedRecord => {
    const added = rows.get(k.resource.id);
    if (!added?.length) return k;
    const known = new Set(k.evidence.map(evidenceKey));
    const fresh: EvidenceWithId[] = added.filter((e) => !known.has(evidenceKey(e))).map((e) => ({ ...e, id: deterministicUuid(`${k.key}|${evidenceKey(e)}`) }));
    const evidence = [...k.evidence, ...fresh];
    return { ...k, evidence, resource: { ...k.resource, evidenceRefs: evidence.map((e) => e.id) } };
  });
}
