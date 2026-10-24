/**
 * Deterministic design/evidence mapping for the Condition Brief. Pure functions, no I/O.
 * Policy lives in the rd-research brief and lib/condition-brief/tagging.ts; this file only maps raw
 * registry/PubMed labels to SourceDesign and a SourceDesign to its evidence-level ceiling.
 */
import type { EvidenceLevel, SourceDesign } from "../contract";

const ESTABLISHED: ReadonlySet<SourceDesign> = new Set([
  "guideline",
  "consensus",
  "systematic_review",
  "meta_analysis",
  "genereviews",
  "reference_page",
]);
const EMERGING: ReadonlySet<SourceDesign> = new Set([
  "narrative_review",
  "primary_study",
  "preprint",
  "trial_early",
  "trial_late",
  "grant",
  "registry",
]);

/** Ceiling of a design: established | emerging | uncertain (case_report, other, unknown). */
export function designCeiling(design: SourceDesign | undefined | null): EvidenceLevel {
  if (!design) return "uncertain";
  if (ESTABLISHED.has(design)) return "established";
  if (EMERGING.has(design)) return "emerging";
  return "uncertain";
}

export interface PubmedDesignOptions {
  /** NCBI Bookshelf accession (NBK...) when the record is a GeneReviews chapter. */
  bookshelfId?: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * PubMed PublicationType list -> SourceDesign. Highest-ranked label wins:
 * guideline > consensus > systematic review > meta-analysis > review > preprint > trial/observational >
 * case report > generic Journal Article (primary_study) > other.
 */
export function pubmedDesign(types: string[], opts: PubmedDesignOptions = {}): SourceDesign {
  if (opts.bookshelfId && /^NBK\d+/i.test(opts.bookshelfId)) return "genereviews";
  const t = types.map(norm);
  const has = (re: RegExp) => t.some((x) => re.test(x));
  if (has(/^(practice )?guideline$/)) return "guideline";
  if (has(/^consensus development conference(, nih)?$/)) return "consensus";
  if (has(/^systematic review$/)) return "systematic_review";
  if (has(/^meta-analysis$/)) return "meta_analysis";
  if (has(/^review$/)) return "narrative_review";
  if (has(/^preprint$/)) return "preprint";
  if (has(/clinical trial|^randomized controlled trial$|^observational study|^comparative study$|^multicenter study$/)) {
    return "primary_study";
  }
  if (has(/^case reports?$/)) return "case_report";
  if (has(/^journal article$/)) return "primary_study";
  return "other";
}

const EARLY = new Set(["EARLY_PHASE1", "PHASE1", "PHASE1/PHASE2", "NA"]);
const LATE = new Set(["PHASE2", "PHASE2/PHASE3", "PHASE3", "PHASE4"]);

/**
 * ClinicalTrials.gov phases array (v2 API gives e.g. ["PHASE1","PHASE2"]) -> trial_early | trial_late.
 * EARLY_PHASE1, PHASE1, PHASE1/PHASE2, NA -> trial_early; PHASE2, PHASE2/PHASE3, PHASE3, PHASE4 -> trial_late.
 * Empty or unrecognised input -> other (uncertain).
 */
export function ctgovPhaseDesign(phases: string[]): SourceDesign {
  const p = phases.map((x) => x.trim().toUpperCase().replace(/\s+/g, "")).filter(Boolean);
  if (p.length === 0) return "other";
  const joined = p.join("/");
  if (EARLY.has(joined) || (p.length === 1 && EARLY.has(p[0]))) return "trial_early";
  if (LATE.has(joined) || (p.length === 1 && LATE.has(p[0]))) return "trial_late";
  const known = p.filter((x) => EARLY.has(x) || LATE.has(x));
  if (known.length !== p.length) return "other";
  if (p.includes("PHASE3") || p.includes("PHASE4")) return "trial_late";
  if (p.includes("PHASE2") && !p.some((x) => x === "PHASE1" || x === "EARLY_PHASE1")) return "trial_late";
  return "trial_early";
}
