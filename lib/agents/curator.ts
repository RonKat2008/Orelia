import type { CaseInput, Curation, CurationReason, CurationTier, Resource, ScoreBreakdownItem } from "@/lib/contracts";
import { curationSchema } from "@/lib/contracts";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";
import { modelFor } from "./models";
import { resourceName, type RankedEntry } from "./persist";
import { buildCuratorPrompt, CURATOR_SYSTEM } from "./prompts/curator";
import type { RunStore } from "./run-store";
import { runAgent, type MessagesClient } from "./runtime";

export const CURATOR_AGENT_NAME = "curator";
export const BEST_PER_KIND = 2;
/** Outreach cap: at most this many suggested contacts. */
export const SUGGESTED_MAX = 5;

const KIND_ORDER: Resource["kind"][] = ["expert", "institution", "trial", "organization"];

export interface CuratorInputCandidate {
  candidateId: string;
  kind: Resource["kind"];
  name: string;
  rank: number;
  score: number;
  breakdown: ScoreBreakdownItem[];
  evidence: { id: string; claimType: string; claim: string; sourceKind: string }[];
}

export interface CuratorInput {
  case: {
    diagnosis: string;
    subtype?: string;
    state?: string;
    city?: string;
    travelLimitMiles?: number;
    goals: string[];
    insurer?: string;
  };
  candidates: CuratorInputCandidate[];
}

export interface TierAssignment {
  candidateId: string;
  kind: Resource["kind"];
  tier: CurationTier;
  reasons: CurationReason[];
}

export interface ValidatedCuration {
  tiers: TierAssignment[];
  summary: string;
  suggested: string[];
  dropped: { candidateId?: string; what: "pick" | "reason" | "summary" | "best_over_cap"; why: string }[];
  source: "model" | "fallback";
}

function kindIndex(k: Resource["kind"]): number {
  return KIND_ORDER.indexOf(k);
}

/** Input order: kind order, then rank. */
function sortEntries(ranked: readonly RankedEntry[]): RankedEntry[] {
  return [...ranked].sort(
    (a, b) => kindIndex(a.record.resource.kind) - kindIndex(b.record.resource.kind) || a.rank - b.rank,
  );
}

export function buildCuratorInput(caseRecord: CaseInput, ranked: readonly RankedEntry[]): CuratorInput {
  const c: CuratorInput["case"] = { diagnosis: caseRecord.diseaseName, goals: [...caseRecord.goals] };
  if (caseRecord.subtype) c.subtype = caseRecord.subtype;
  if (caseRecord.homeState) c.state = caseRecord.homeState;
  if (caseRecord.homeCity) c.city = caseRecord.homeCity;
  if (caseRecord.travelLimitMiles !== undefined) c.travelLimitMiles = caseRecord.travelLimitMiles;
  if (caseRecord.insurer) c.insurer = caseRecord.insurer;
  return {
    case: c,
    candidates: sortEntries(ranked).map((e) => ({
      candidateId: e.record.resource.id,
      kind: e.record.resource.kind,
      name: resourceName(e.record.resource),
      rank: e.rank,
      score: e.score,
      breakdown: e.breakdown,
      evidence: e.record.evidence.map((ev) => ({
        id: ev.id,
        claimType: ev.claimType,
        claim: ev.claim,
        sourceKind: ev.sourceKind,
      })),
    })),
  };
}

function finish(
  entries: RankedEntry[],
  tiers: TierAssignment[],
  summary: string,
  dropped: ValidatedCuration["dropped"],
  source: ValidatedCuration["source"],
): ValidatedCuration {
  const rankOf = new Map(entries.map((e) => [e.record.resource.id, e.rank]));
  const suggested = tiers
    .filter((t) => t.tier === "best")
    .sort((a, b) => kindIndex(a.kind) - kindIndex(b.kind) || (rankOf.get(a.candidateId) ?? 0) - (rankOf.get(b.candidateId) ?? 0))
    .slice(0, SUGGESTED_MAX)
    .map((t) => t.candidateId);
  return { tiers, summary, suggested, dropped, source };
}

/** Deterministic gate on the model's curation. The model proposes; this code decides what survives. */
export function validateCuration(raw: Curation, ranked: readonly RankedEntry[]): ValidatedCuration {
  const entries = sortEntries(ranked);
  const dropped: ValidatedCuration["dropped"] = [];
  const evidenceById = new Map(entries.map((e) => [e.record.resource.id, new Set(e.record.evidence.map((ev) => ev.id))]));
  const picked = new Map<string, { tier: CurationTier; reasons: CurationReason[] }>();

  for (const pick of raw.picks) {
    const allowed = evidenceById.get(pick.candidateId);
    if (!allowed) {
      dropped.push({ candidateId: pick.candidateId, what: "pick", why: "unknown candidateId" });
      continue;
    }
    if (picked.has(pick.candidateId)) {
      dropped.push({ candidateId: pick.candidateId, what: "pick", why: "duplicate pick" });
      continue;
    }
    const reasons: CurationReason[] = [];
    for (const r of pick.reasons) {
      if (r.evidenceIds.length === 0) {
        dropped.push({ candidateId: pick.candidateId, what: "reason", why: "reason cites no evidence" });
      } else if (r.evidenceIds.some((id) => !allowed.has(id))) {
        dropped.push({ candidateId: pick.candidateId, what: "reason", why: "reason cites evidence not attached to this candidate" });
      } else if (flagMedicalAdvice(r.text).flagged) {
        dropped.push({ candidateId: pick.candidateId, what: "reason", why: "reason flagged as medical advice" });
      } else {
        reasons.push(r);
      }
    }
    picked.set(pick.candidateId, { tier: pick.tier, reasons });
  }

  const tiers: TierAssignment[] = entries.map((e) => {
    const id = e.record.resource.id;
    const p = picked.get(id);
    return { candidateId: id, kind: e.record.resource.kind, tier: p?.tier ?? "backup", reasons: p?.reasons ?? [] };
  });

  // A top pick must be justified by evidence.
  for (const t of tiers) {
    if (t.tier === "best" && t.reasons.length === 0) {
      t.tier = "good";
      dropped.push({ candidateId: t.candidateId, what: "best_over_cap", why: "best pick had no valid evidence-cited reason; demoted to good" });
    }
  }
  // Cap best per kind, keeping the best-ranked (tiers are already in kind, rank order).
  const bestCount = new Map<Resource["kind"], number>();
  for (const t of tiers) {
    if (t.tier !== "best") continue;
    const n = (bestCount.get(t.kind) ?? 0) + 1;
    bestCount.set(t.kind, n);
    if (n > BEST_PER_KIND) {
      t.tier = "good";
      dropped.push({ candidateId: t.candidateId, what: "best_over_cap", why: `more than ${BEST_PER_KIND} best for kind ${t.kind}; demoted to good` });
    }
  }

  let summary = raw.summary;
  if (flagMedicalAdvice(summary).flagged) {
    summary = "";
    dropped.push({ what: "summary", why: "summary flagged as medical advice" });
  }
  return finish(entries, tiers, summary, dropped, "model");
}

export function fallbackCuration(ranked: readonly RankedEntry[], why: string): ValidatedCuration {
  const entries = sortEntries(ranked);
  const tiers: TierAssignment[] = entries.map((e) => ({
    candidateId: e.record.resource.id,
    kind: e.record.resource.kind,
    tier: "backup",
    reasons: [],
  }));
  return { tiers, summary: "", suggested: [], dropped: [{ what: "pick", why }], source: "fallback" };
}

export interface CuratorDeps {
  store: RunStore;
  offlineKey: string;
  client?: MessagesClient;
}

export async function runCurator(
  caseId: string,
  caseRecord: CaseInput,
  ranked: readonly RankedEntry[],
  deps: CuratorDeps,
): Promise<ValidatedCuration> {
  if (ranked.length === 0) return { tiers: [], summary: "", suggested: [], dropped: [], source: "model" };
  try {
    const input = buildCuratorInput(caseRecord, ranked);
    const raw = await runAgent({
      name: CURATOR_AGENT_NAME,
      model: modelFor("curator"),
      system: CURATOR_SYSTEM,
      prompt: buildCuratorPrompt(input),
      tools: [],
      output: curationSchema,
      caseId,
      store: deps.store,
      offlineKey: deps.offlineKey,
      ...(deps.client ? { client: deps.client } : {}),
    });
    return validateCuration(raw, ranked);
  } catch (e) {
    return fallbackCuration(ranked, e instanceof Error ? e.message : String(e));
  }
}
