import type { ScoreBreakdownItem } from "@/lib/contracts";

/**
 * Placeholder ranker, used only until lib/ranking/rank.ts (Codex, task #4) lands.
 * Interface mirrors Codex's: rank(candidates, weights?) -> input fields + score, rank, breakdown.
 * Deliberately simple: weighted sum of 0..1 signals, equal weights.
 */

export const SIGNAL_NAMES = ["subtypeExpertise", "institutionalFit", "access", "contactability"] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

export interface RankSignal {
  value: number;
  text: string;
  evidenceIds: string[];
}

export interface RankingCandidate {
  id: string;
  signals?: Partial<Record<SignalName, RankSignal>>;
}

export type Ranked<T extends RankingCandidate> = T & {
  score: number;
  rank: number;
  breakdown: ScoreBreakdownItem[];
};

export type RankWeights = Record<string, number>;

export type RankFn = <T extends RankingCandidate>(candidates: readonly T[], weights?: RankWeights) => Ranked<T>[];

const DEFAULT_WEIGHTS: RankWeights = {
  subtypeExpertise: 0.25,
  institutionalFit: 0.25,
  access: 0.25,
  contactability: 0.25,
};

export const placeholderRank: RankFn = (candidates, weights = DEFAULT_WEIGHTS) => {
  const scored = candidates.map((c) => {
    const breakdown: ScoreBreakdownItem[] = SIGNAL_NAMES.map((name) => {
      const sig = c.signals?.[name];
      const value = Math.min(1, Math.max(0, sig?.value ?? 0));
      return {
        factor: name,
        points: Math.round(value * (weights[name] ?? 0) * 100 * 100) / 100,
        text: sig?.text ?? "No supporting evidence found",
        evidenceIds: sig?.evidenceIds ?? [],
      };
    });
    const score = Math.round(breakdown.reduce((s, b) => s + b.points, 0) * 100) / 100;
    return { ...c, score, breakdown };
  });
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
};
