/**
 * Deterministic evidence-level policy for the Condition Brief (canonical copy).
 * A statement's level = min(proposed level, max ceiling across its cited sources). Unknown/missing tags -> uncertain.
 */
import { EVIDENCE_LEVELS, LEVEL_RANK, type BriefSource, type EvidenceLevel, type SourceDesign } from "./contract";

/** Levels ordered weakest -> strongest. */
export const LEVEL_ORDER: readonly EvidenceLevel[] = [...EVIDENCE_LEVELS].sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b]);

const CEILING: Record<SourceDesign, EvidenceLevel> = {
  guideline: "established",
  consensus: "established",
  systematic_review: "established",
  meta_analysis: "established",
  genereviews: "established",
  reference_page: "established",
  narrative_review: "emerging",
  primary_study: "emerging",
  preprint: "emerging",
  trial_early: "emerging",
  trial_late: "emerging",
  grant: "emerging",
  registry: "emerging",
  case_report: "uncertain",
  other: "uncertain",
};

function isLevel(value: unknown): value is EvidenceLevel {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEVEL_RANK, value);
}

/** Highest level a source of this design can support. Unknown design -> uncertain. */
export function designCeiling(design: SourceDesign | string | undefined): EvidenceLevel {
  if (typeof design !== "string" || !Object.prototype.hasOwnProperty.call(CEILING, design)) return "uncertain";
  return CEILING[design as SourceDesign];
}

export function minLevel(a: EvidenceLevel, b: EvidenceLevel): EvidenceLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

export function maxLevel(a: EvidenceLevel, b: EvidenceLevel): EvidenceLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/** Strongest ceiling among the cited sources; no sources -> uncertain. */
export function sourcesCeiling(sources: readonly Pick<BriefSource, "design">[]): EvidenceLevel {
  return sources.reduce<EvidenceLevel>((best, s) => maxLevel(best, designCeiling(s.design)), "uncertain");
}

/** Cap a proposed level by what the cited sources support. Unknown proposed level -> uncertain. */
export function capLevel(proposed: EvidenceLevel | string | undefined, sources: readonly Pick<BriefSource, "design">[]): EvidenceLevel {
  if (!isLevel(proposed)) return "uncertain";
  return minLevel(proposed, sourcesCeiling(sources));
}
