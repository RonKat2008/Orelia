import { RANKING_WEIGHTS, type RankingFactor, type RankingWeights } from "@/config/ranking";
import { rank, type RankingCandidate, type RankingSignal } from "@/lib/ranking/rank";

export const RANKING_FACTORS: RankingFactor[] = [
  "subtypeExpertise",
  "institutionalFit",
  "access",
  "contactability",
];

export const NO_VERIFIED_EVIDENCE = "No verified evidence available";

/** Stored breakdowns were scored with these weights. Preview recovers 0–1 signals from them. */
export const STORED_BREAKDOWN_WEIGHTS: RankingWeights = RANKING_WEIGHTS;

export const FACTOR_COPY: Record<RankingFactor, { label: string; help: string }> = {
  subtypeExpertise: {
    label: "Subtype expertise",
    help: "How closely the resource’s published work matches this disease subtype. This carries the most weight by default.",
  },
  institutionalFit: {
    label: "Institutional fit",
    help: "Whether the person or program sits at a center set up for this kind of disease.",
  },
  access: {
    label: "Access",
    help: "Whether a patient can realistically get in: recruiting status, in-state care, or a public intake door. This is not a judgment about which treatment is better.",
  },
  contactability: {
    label: "Contactability",
    help: "Whether a public office, trial site, or organization contact is on file. Personal emails are never preferred.",
  },
};

export const RANKING_FORMULA =
  "score = subtype expertise × its weight + institutional fit × its weight + access × its weight + contactability × its weight. A factor counts only when verified evidence supports it. Ties break by candidate id. Nothing here ranks treatments.";

export interface StoredBreakdownItem {
  factor: string;
  points: number;
  text: string;
  evidenceIds: string[];
}

export interface StoredCandidate {
  id: string;
  targetKind: string;
  targetId: string;
  scoreBreakdown: StoredBreakdownItem[] | null;
}

const TARGET_KINDS = ["expert", "institution", "trial", "organization"] as const;
export type ReviewTargetKind = (typeof TARGET_KINDS)[number];
export type ReviewVerdict = "correct" | "incorrect";

export function isRankingFactor(value: string): value is RankingFactor {
  return (RANKING_FACTORS as string[]).includes(value);
}

export function isTargetKind(value: string): value is ReviewTargetKind {
  return (TARGET_KINDS as readonly string[]).includes(value);
}

export function parseWeights(input: unknown): { ok: true; weights: RankingWeights } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "weights must be an object with the four ranking factors" };
  }
  const record = input as Record<string, unknown>;
  const weights = {} as RankingWeights;
  for (const factor of RANKING_FACTORS) {
    const value = record[factor];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, error: `${factor} must be a finite number of 0 or more` };
    }
    weights[factor] = value;
  }
  return { ok: true, weights };
}

export function signalsFromBreakdown(
  breakdown: StoredBreakdownItem[] | null | undefined,
  prior: RankingWeights = STORED_BREAKDOWN_WEIGHTS,
): Partial<Record<RankingFactor, RankingSignal>> {
  const signals: Partial<Record<RankingFactor, RankingSignal>> = {};
  for (const item of breakdown ?? []) {
    if (!isRankingFactor(item.factor)) continue;
    const weight = prior[item.factor];
    const text = item.text?.trim() ?? "";
    const evidenceIds = [...new Set(item.evidenceIds ?? [])].filter((id) => id.length > 0);
    if (!text || text === NO_VERIFIED_EVIDENCE || evidenceIds.length === 0) continue;
    if (!(weight > 0) || !(item.points > 0)) continue;
    signals[item.factor] = {
      value: Math.min(1, item.points / weight),
      text,
      evidenceIds,
    };
  }
  return signals;
}

export function previewRank(candidates: readonly StoredCandidate[], weights: RankingWeights) {
  const parsed = parseWeights(weights);
  if (!parsed.ok) throw new Error(parsed.error);
  const withSignals: (RankingCandidate & { targetKind: string; targetId: string })[] = candidates.map(
    (candidate) => ({
      id: candidate.id,
      targetKind: candidate.targetKind,
      targetId: candidate.targetId,
      signals: signalsFromBreakdown(candidate.scoreBreakdown),
    }),
  );
  return rank(withSignals, parsed.weights).map((row) => ({
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    rank: row.rank,
    score: row.score,
    breakdown: row.breakdown,
  }));
}

export interface ReviewMark {
  targetKind: string;
  verdict: ReviewVerdict;
}

export interface AgreementSummary {
  targetKind: ReviewTargetKind;
  correct: number;
  incorrect: number;
  total: number;
  agreementRate: number;
}

export function agreementByKind(marks: readonly ReviewMark[]): AgreementSummary[] {
  return TARGET_KINDS.map((targetKind) => {
    const subset = marks.filter((mark) => mark.targetKind === targetKind);
    const correct = subset.filter((mark) => mark.verdict === "correct").length;
    const incorrect = subset.filter((mark) => mark.verdict === "incorrect").length;
    const total = correct + incorrect;
    return {
      targetKind,
      correct,
      incorrect,
      total,
      agreementRate: total === 0 ? 0 : correct / total,
    };
  }).filter((row) => row.total > 0);
}
