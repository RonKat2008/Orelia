/**
 * Deterministic guardrails on the final judge. The model proposes verdicts; this code decides what survives:
 *  1. evidence ids must be ones attached to THAT candidate in the input; invented ids are removed and reported;
 *  2. a keep (or maybe) with no valid evidence becomes a drop;
 *  3. hard scope rules (adult, U.S.) force a drop; soft flags (travel, licensure, recruiting) cap the tier and are
 *     always shown in the reason;
 *  4. every drop has a reason; reasons/plain text pass the no-medical-advice filter or are replaced by code text;
 *  5. results are stable: sorted by verdict band, tier, deterministic score, id; keeps capped per kind.
 */
import type { CareNeeds, CurationTier, JudgeConfidence, Judgement, JudgeVerdict, RawJudgeOutput, Resource, ScopeFlag } from "@/lib/contracts";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";
import { resourceName, type RankedEntry } from "../persist";

export const KEEP_PER_KIND = 6;
export const BEST_PER_KIND = 2;
const KIND_ORDER: Resource["kind"][] = ["expert", "institution", "trial", "organization"];
const VERDICT_BAND: Record<JudgeVerdict, number> = { keep: 0, maybe: 1, drop: 2 };
const TIER_BAND: Record<CurationTier, number> = { best: 0, good: 1, backup: 2, exclude: 3 };
const TIER_ORDER: CurationTier[] = ["best", "good", "backup", "exclude"];

export interface GuardInput {
  entries: readonly RankedEntry[];
  needs?: CareNeeds;
  flags: ReadonlyMap<string, ScopeFlag[]>;
  source: "model" | "fallback";
}

export interface GuardOutput {
  judgements: Judgement[];
  rejected: { candidateId?: string; why: string }[];
}

/** All CareNeeds item ids (judge may reference only these in needsMet / needsMissed). */
export function needIds(needs: CareNeeds | undefined): Set<string> {
  if (!needs) return new Set();
  return new Set(
    [needs.specialties, needs.centerCapabilities, needs.redFlags, needs.trialEligibility, needs.supportNeeds].flatMap((list) => list.map((i) => i.id)),
  );
}

const capTier = (tier: CurationTier, cap: CurationTier): CurationTier => (TIER_BAND[tier] < TIER_BAND[cap] ? cap : tier);
const safe = (text: string) => !flagMedicalAdvice(text).flagged;

function codeReason(e: RankedEntry, verdict: JudgeVerdict): string {
  const top = [...e.breakdown].filter((b) => b.points > 0).sort((a, b) => b.points - a.points)[0];
  if (verdict === "drop") return top ? `Dropped: ${top.text}` : "Dropped: no verified evidence of fit or access.";
  return top ? top.text : "Shown on its deterministic score; no judge reason.";
}

function plainFor(verdict: JudgeVerdict, name: string): string {
  return verdict === "keep" ? `${name} looks like a fit for what you need.` : verdict === "maybe" ? `${name} may fit; check the details.` : `${name} was set aside; see why.`;
}

/** A flag counts as already stated when the reason mentions its topic in any wording. */
const FLAG_TOPIC: Record<ScopeFlag["code"], RegExp> = {
  beyond_travel: /travel limit|(?:past|beyond)[^·]{0,24}\blimit\b|\d[\d,]*\s?(?:mi|miles?)\b[^·]{0,16}(?:past|beyond)/i,
  out_of_state_license: /licen[cs]/i,
  not_recruiting: /recruit/i,
  pediatric_only: /child|pediatric|paediatric/i,
  non_us: /outside the u\.?s|non-u\.?s|no u\.?s\.? site/i,
};

function withFlags(reason: string, flags: readonly ScopeFlag[]): string {
  const missing = flags.filter((f) => !FLAG_TOPIC[f.code].test(reason));
  return [reason, ...missing.map((f) => f.text)].join(" · ").slice(0, 600);
}

/** CareNeeds ids belong in needsMet/needsMissed, not in patient-facing text. */
const NEED_ID_TOKEN = /\s*\((?:[^()]*?\b)?(?:spec|cap|flag|elig|support|q)-\d+\b[^()]*\)|\b(?:spec|cap|flag|elig|support|q)-\d+\b/g;
export function stripNeedIds(text: string): string {
  return text.replace(NEED_ID_TOKEN, "").replace(/\s+·/g, " ·").replace(/\s{2,}/g, " ").trim();
}

interface Draft {
  e: RankedEntry;
  verdict: JudgeVerdict;
  tier: CurationTier;
  reason: string;
  plain: string;
  evidenceIds: string[];
  needsMet: string[];
  needsMissed: string[];
  confidence: JudgeConfidence;
  overrides: string[];
  source: "model" | "fallback";
}

/** Candidate the model did not judge (or fallback): shown on its score as a "maybe", never a keep. */
function unreviewed(e: RankedEntry, source: "model" | "fallback"): Draft {
  return {
    e,
    verdict: "maybe",
    tier: "backup",
    reason: codeReason(e, "maybe"),
    plain: plainFor("maybe", resourceName(e.record.resource)),
    evidenceIds: [...new Set(e.breakdown.flatMap((b) => b.evidenceIds))].sort(),
    needsMet: [],
    needsMissed: [],
    confidence: "low",
    overrides: [source === "model" ? "not judged by the model; shown on its deterministic score" : "judge unavailable; shown on its deterministic score"],
    source: "fallback",
  };
}

function applyRules(d: Draft, flags: readonly ScopeFlag[]): Draft {
  const out: Draft = { ...d, overrides: [...d.overrides] };
  const name = resourceName(out.e.record.resource);
  if (out.verdict !== "drop" && out.evidenceIds.length === 0) {
    out.overrides.push(`${out.verdict} without valid evidence -> drop`);
    out.verdict = "drop";
    out.reason = `Dropped: no valid evidence was cited for this pick. ${out.reason}`;
  }
  const hard = flags.find((f) => f.hard);
  if (hard && out.verdict !== "drop") {
    out.overrides.push(`hard scope rule (${hard.code}) -> drop`);
    out.verdict = "drop";
    out.reason = `Dropped: ${hard.text}.`;
  }
  if (!safe(out.reason)) {
    out.overrides.push("reason failed the no-medical-advice filter; replaced by code text");
    out.reason = codeReason(out.e, out.verdict);
  }
  if (!safe(out.plain)) {
    out.overrides.push("plain sentence failed the no-medical-advice filter; replaced");
    out.plain = plainFor(out.verdict, name);
  }
  if (out.verdict === "drop") {
    out.tier = "exclude";
    if (!out.reason.trim()) out.reason = codeReason(out.e, "drop");
  } else {
    if (out.tier === "exclude") out.tier = "backup";
    if (out.verdict === "maybe") out.tier = capTier(out.tier, "good");
    if (flags.some((f) => f.code === "beyond_travel") && out.tier === "best") {
      out.overrides.push("beyond the travel limit: best -> good");
      out.tier = "good";
    }
    if (flags.some((f) => f.code === "not_recruiting")) out.tier = capTier(out.tier, "backup");
  }
  out.reason = withFlags(out.reason, flags);
  return out;
}

/** Validate model judgements against the input and produce the stable, sorted, capped verdict list. */
export function guardJudgements(raw: RawJudgeOutput | undefined, input: GuardInput): GuardOutput {
  const rejected: GuardOutput["rejected"] = [];
  const byId = new Map(input.entries.map((e) => [e.record.resource.id, e]));
  const allowedNeeds = needIds(input.needs);
  const drafts = new Map<string, Draft>();

  for (const j of raw?.judgements ?? []) {
    const e = byId.get(j.candidateId);
    if (!e) {
      rejected.push({ candidateId: j.candidateId, why: "unknown candidateId (not in the judge's input)" });
      continue;
    }
    if (drafts.has(j.candidateId)) {
      rejected.push({ candidateId: j.candidateId, why: "duplicate judgement" });
      continue;
    }
    const allowed = new Set(e.record.evidence.map((ev) => ev.id));
    const invented = j.evidenceIds.filter((id) => !allowed.has(id));
    const overrides: string[] = [];
    if (invented.length) {
      rejected.push({ candidateId: j.candidateId, why: `cited evidence ids not in its input: ${invented.join(", ")}` });
      overrides.push(`removed ${invented.length} evidence id(s) not in the input`);
    }
    drafts.set(j.candidateId, {
      e,
      verdict: j.verdict,
      tier: j.tier,
      reason: stripNeedIds(j.reason),
      plain: stripNeedIds(j.plain),
      evidenceIds: [...new Set(j.evidenceIds.filter((id) => allowed.has(id)))].sort(),
      needsMet: [...new Set(j.needsMet.filter((id) => allowedNeeds.has(id)))].sort(),
      needsMissed: [...new Set(j.needsMissed.filter((id) => allowedNeeds.has(id)))].sort(),
      confidence: j.confidence,
      overrides,
      source: "model",
    });
  }

  const ruled = input.entries.map((e) => {
    const id = e.record.resource.id;
    return applyRules(drafts.get(id) ?? unreviewed(e, input.source), input.flags.get(id) ?? []);
  });

  // Stable order: verdict band, tier, deterministic score (desc), rank, id.
  ruled.sort(
    (a, b) =>
      VERDICT_BAND[a.verdict] - VERDICT_BAND[b.verdict] ||
      TIER_BAND[a.tier] - TIER_BAND[b.tier] ||
      b.e.score - a.e.score ||
      a.e.rank - b.e.rank ||
      (a.e.record.resource.id < b.e.record.resource.id ? -1 : 1),
  );

  // Caps per kind: at most KEEP_PER_KIND keeps and BEST_PER_KIND best, in the sorted order.
  const keeps = new Map<string, number>();
  const bests = new Map<string, number>();
  for (const d of ruled) {
    const kind = d.e.record.resource.kind;
    if (d.verdict === "keep") {
      const n = (keeps.get(kind) ?? 0) + 1;
      keeps.set(kind, n);
      if (n > KEEP_PER_KIND) {
        d.verdict = "maybe";
        d.tier = capTier(d.tier, "good");
        d.overrides.push(`more than ${KEEP_PER_KIND} keeps for ${kind}: keep -> maybe`);
      }
    }
    if (d.tier === "best") {
      const n = (bests.get(kind) ?? 0) + 1;
      bests.set(kind, n);
      if (n > BEST_PER_KIND) {
        d.tier = "good";
        d.overrides.push(`more than ${BEST_PER_KIND} best for ${kind}: best -> good`);
      }
    }
  }
  ruled.sort(
    (a, b) =>
      VERDICT_BAND[a.verdict] - VERDICT_BAND[b.verdict] ||
      TIER_BAND[a.tier] - TIER_BAND[b.tier] ||
      b.e.score - a.e.score ||
      a.e.rank - b.e.rank ||
      (a.e.record.resource.id < b.e.record.resource.id ? -1 : 1),
  );

  const judgements: Judgement[] = ruled.map((d, i) => ({
    ...refsOf(d.e.record.resource),
    links: d.evidenceIds.slice(0, 8).flatMap((id) => {
      const ev = d.e.record.evidence.find((x) => x.id === id);
      return ev ? [{ id, url: ev.sourceUrl, claim: ev.claim.slice(0, 300) }] : [];
    }),
    candidateId: d.e.record.resource.id,
    kind: d.e.record.resource.kind,
    name: resourceName(d.e.record.resource),
    verdict: d.verdict,
    tier: d.tier,
    reason: d.reason,
    plain: d.plain,
    evidenceIds: d.evidenceIds,
    needsMet: d.needsMet,
    needsMissed: d.needsMissed,
    confidence: d.confidence,
    flags: [...(input.flags.get(d.e.record.resource.id) ?? [])],
    score: d.e.score,
    rank: d.e.rank,
    order: i + 1,
    overrides: d.overrides,
    source: d.source,
  }));
  return { judgements, rejected };
}

function refsOf(r: Resource): { nctId?: string; npi?: string } {
  if (r.kind === "trial") return { nctId: r.nctId };
  if (r.kind === "expert" && r.npi) return { npi: r.npi };
  return {};
}

export const kindIndex = (k: Resource["kind"]) => KIND_ORDER.indexOf(k);
export { TIER_ORDER };
