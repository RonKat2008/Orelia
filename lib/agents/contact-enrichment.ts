import type { ExaPort } from "./research/source-ports";
import { deterministicUuid, type EvidenceWithId, type VerifiedRecord, type VerifyOutput } from "./verifier";
import { enrichInstitutions } from "@/lib/contact-finder/enrich";

const DEFAULT_BUDGET_MS = 30_000;

const evidenceKey = (e: { sourceUrl: string; claimType: string; claim: string }) => `${e.sourceUrl}|${e.claimType}|${e.claim}`;

/**
 * After verification, give kept institutions without a phone a code-stamped intake contact point from their own
 * site (see lib/contact-finder/enrich). Ids follow the verifier's scheme. Bounded in time; on timeout or error the
 * verified output is returned unchanged, so research never fails because of this step.
 */
export async function enrichVerified(verified: VerifyOutput, exa: ExaPort, now: Date, budgetMs = DEFAULT_BUDGET_MS): Promise<VerifyOutput> {
  const institutions = verified.kept.filter((k) => k.resource.kind === "institution");
  if (institutions.length === 0) return verified;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });
  const rows = await Promise.race([
    enrichInstitutions(institutions.map((k) => ({ targetKind: "institution" as const, targetId: k.resource.id, name: "name" in k.resource ? k.resource.name : "", evidence: k.evidence })), exa, now.toISOString()).catch(() => null),
    timeout,
  ]).finally(() => clearTimeout(timer));
  if (!rows || rows.size === 0) return verified;
  const kept = verified.kept.map((k): VerifiedRecord => {
    const added = rows.get(k.resource.id);
    if (!added?.length) return k;
    const known = new Set(k.evidence.map(evidenceKey));
    const fresh: EvidenceWithId[] = added.filter((e) => !known.has(evidenceKey(e))).map((e) => ({ ...e, id: deterministicUuid(`${k.key}|${evidenceKey(e)}`) }));
    const evidence = [...k.evidence, ...fresh];
    return { ...k, evidence, resource: { ...k.resource, evidenceRefs: evidence.map((e) => e.id) } };
  });
  return { ...verified, kept };
}
