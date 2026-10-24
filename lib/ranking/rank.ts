import { RANKING_WEIGHTS, type RankingFactor, type RankingWeights } from "../../config/ranking";
import type { ScoreBreakdownItem, ScoreComponent } from "../contracts/agent-io";
/** `weight` is the component's 0..1 share of the factor; when given, rank() derives the component's points. */
export interface RankingSignalComponent {key: string; label: string; value: number; weight?: number; detail: string; evidenceIds: string[]}
export interface RankingSignal {value: number; text: string; evidenceIds: string[]; components?: RankingSignalComponent[]}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** Components survive only inside a supported factor, citing a subset of the factor's evidence ids. */
function passComponents(signal: RankingSignal, evidenceIds: string[], factorWeight: number): ScoreComponent[] | undefined {
  if (!signal.components?.length) return undefined;
  const allowed = new Set(evidenceIds);
  return signal.components.map(c => {
    if (!Number.isFinite(c.value) || c.value < 0 || c.value > 1) throw new Error(`Invalid ${c.key} component`);
    const ids = [...new Set(c.evidenceIds)].filter(id => allowed.has(id)).sort();
    const value = ids.length ? c.value : 0;
    const item: ScoreComponent = {key: c.key, label: c.label, value, detail: c.detail, evidenceIds: ids};
    if (c.weight !== undefined) item.points = round6(value * c.weight * factorWeight);
    return item;
  });
}
export interface RankingCandidate {id: string; signals?: Partial<Record<RankingFactor, RankingSignal>>}
export type Ranked<T extends RankingCandidate = RankingCandidate> = T & {rank: number; score: number; breakdown: ScoreBreakdownItem[]};
const factors: RankingFactor[] = ["subtypeExpertise","institutionalFit","access","contactability"];
/** Scores resource fit and access only. Never ranks therapies or infers unsupported signals. */
export function rank<T extends RankingCandidate>(candidates: readonly T[], weights: RankingWeights = RANKING_WEIGHTS): Ranked<T>[] {
  if (factors.some(f => !Number.isFinite(weights[f]) || weights[f] < 0)) throw new Error("Ranking weights must be finite and non-negative");
  const ids = new Set<string>();
  const scored = candidates.map(candidate => {
    if (!candidate.id || ids.has(candidate.id)) throw new Error("Ranking requires unique nonempty candidate IDs");
    ids.add(candidate.id);
    const breakdown = factors.map(factor => {
      const signal = candidate.signals?.[factor];
      if (signal && (!Number.isFinite(signal.value) || signal.value < 0 || signal.value > 1)) throw new Error(`Invalid ${factor} signal`);
      const evidenceIds = [...new Set(signal?.evidenceIds ?? [])].sort();
      const supported = !!signal && evidenceIds.length > 0 && !!signal.text.trim();
      const components = supported ? passComponents(signal, evidenceIds, weights[factor]) : undefined;
      return {factor, points: supported ? Math.round(signal.value * weights[factor] * 1e6) / 1e6 : 0,
        text: supported ? signal.text : "No verified evidence available", evidenceIds: supported ? evidenceIds : [], ...(components ? {components} : {})};
    });
    return {...candidate,score:Math.round(breakdown.reduce((sum,b) => sum+b.points,0)*1e6)/1e6,rank:0,breakdown};
  });
  scored.sort((a,b) => b.score-a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.map((c,index) => ({...c,rank:index+1}));
}
