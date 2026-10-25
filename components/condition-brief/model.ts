import type {
  BriefSource,
  BriefSourceKind,
  BriefStatement,
  ConditionBrief,
  EvidenceLevel,
  SourceDesign,
} from "@/lib/condition-brief/contract";
import { LEVEL_RANK } from "@/lib/condition-brief/contract";
import { formatSourceDate, parseSource } from "@/lib/ui/format";

export type LevelFilter = "all" | EvidenceLevel;

export const LEVEL_FILTERS: readonly LevelFilter[] = ["all", "established", "emerging", "uncertain"];

export const LEVEL_LABEL: Record<LevelFilter, string> = {
  all: "All",
  established: "Established",
  emerging: "Emerging",
  uncertain: "Uncertain",
};

/** One plain-language sentence per level, shown in the legend. */
export const LEVEL_EXPLAINER: Record<EvidenceLevel, string> = {
  established:
    "Backed by guidelines, systematic reviews, consensus statements, GeneReviews or curated reference pages.",
  emerging: "Reported in single studies, early trials or funded projects, so still being tested.",
  uncertain: "Based on case reports or limited sources, so not yet reliable.",
};

export const QUESTIONS_FRAMING = "Questions you might bring to your care team. Orelia does not give medical advice.";
export const EMPTY_SECTION = "Nothing found in the sources we checked.";
export const EMPTY_FILTERED = "Nothing at this level in this section.";

const KIND_LABEL: Record<BriefSourceKind, string> = {
  orphanet: "Orphanet",
  gard: "GARD",
  nord: "NORD",
  genereviews: "GeneReviews",
  medlineplus: "MedlinePlus",
  pubmed: "PubMed",
  ctgov: "ClinicalTrials.gov",
  reporter: "NIH RePORTER",
  registry: "Patient registry",
  web: "Web page",
};

const KIND_ABBR: Partial<Record<BriefSourceKind, string>> = {
  ctgov: "CT.gov",
  reporter: "RePORTER",
  registry: "Registry",
};

const DESIGN_NOUN: Record<SourceDesign, string> = {
  guideline: "guideline",
  consensus: "consensus statement",
  systematic_review: "systematic review",
  meta_analysis: "meta-analysis",
  genereviews: "",
  reference_page: "",
  narrative_review: "review",
  primary_study: "study",
  case_report: "case report",
  preprint: "preprint",
  trial_early: "early trial",
  trial_late: "later-phase trial",
  grant: "funded project",
  registry: "",
  other: "",
};

/** The design label in plain words, shown in the source drawer. */
export const DESIGN_PLAIN: Record<SourceDesign, string> = {
  guideline: "A clinical practice guideline written by an expert group.",
  consensus: "A consensus statement: experts agreeing on what is known.",
  systematic_review: "A systematic review: a structured search and summary of all the studies on a question.",
  meta_analysis: "A meta-analysis: results from several studies combined statistically.",
  genereviews: "A GeneReviews entry: an expert-written, peer-reviewed summary of a genetic condition.",
  reference_page: "A curated reference page from a rare disease knowledge base.",
  narrative_review: "A review article: an expert summary of published work, without a structured search.",
  primary_study: "A single research study reporting its own results.",
  case_report: "A case report: a description of one or a few patients.",
  preprint: "A preprint: a paper shared before peer review.",
  trial_early: "An early-stage clinical trial, often small and focused on safety.",
  trial_late: "A later-phase clinical trial, testing a treatment in larger groups.",
  grant: "A funded research project. It shows what is being studied, not what was found.",
  registry: "A patient registry that collects information from people with a condition.",
  other: "A source whose study type could not be determined.",
};

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

export function kindLabel(kind: BriefSourceKind): string {
  return KIND_LABEL[kind];
}

export function kindAbbr(kind: BriefSourceKind): string {
  return KIND_ABBR[kind] ?? KIND_LABEL[kind];
}

export function designNoun(design: SourceDesign): string {
  return DESIGN_NOUN[design];
}

export interface NumberedSource {
  n: number;
  source: BriefSource;
}

export type SourceIndex = ReadonlyMap<string, NumberedSource>;

export function indexSources(sources: readonly BriefSource[]): SourceIndex {
  return new Map(sources.map((source, i) => [source.id, { n: i + 1, source }] as const));
}

/** Short visible chip text, e.g. "PubMed 2021". The number is rendered separately. */
export function chipText(source: BriefSource): string {
  return [kindAbbr(source.kind), source.year].filter(Boolean).join(" ");
}

/** What kind of source it is, e.g. "PubMed review". Read after the visible chip text (number and short name). */
export function chipDetail(source: BriefSource): string {
  const label = kindLabel(source.kind);
  const noun = designNoun(source.design);
  return noun && !label.toLowerCase().includes(noun.toLowerCase()) ? `${label} ${noun}` : label;
}

export function fetchedDate(source: BriefSource): string | null {
  return formatSourceDate(source.fetchedAt);
}

/** Only http(s) addresses become links. */
export function safeHref(url: string): string | null {
  return parseSource(url).href;
}

export function matchesLevel(level: EvidenceLevel, filter: LevelFilter): boolean {
  return filter === "all" || level === filter;
}

/** Highest level the cited sources can support (used for items that carry no level of their own). */
export function ceilingFor(sourceIds: readonly string[], index: SourceIndex): EvidenceLevel {
  let best: EvidenceLevel = "uncertain";
  for (const id of sourceIds) {
    const entry = index.get(id);
    if (entry && LEVEL_RANK[CEILING[entry.source.design]] > LEVEL_RANK[best]) best = CEILING[entry.source.design];
  }
  return best;
}

export function filterStatements(
  statements: readonly BriefStatement[],
  sections: readonly BriefStatement["section"][],
  filter: LevelFilter,
): BriefStatement[] {
  return statements.filter((s) => sections.includes(s.section) && matchesLevel(s.evidenceLevel, filter));
}

/** How many statements and items at each level, for the legend counts. */
export function levelCounts(brief: ConditionBrief): Record<LevelFilter, number> {
  const index = indexSources(brief.sources);
  const levels: EvidenceLevel[] = [
    ...brief.statements.map((s) => s.evidenceLevel),
    ...brief.prevalence.map((p) => ceilingFor([p.sourceId], index)),
    ...brief.studies.map((s) => s.evidenceLevel),
    ...brief.research.map((r) => r.evidenceLevel),
    ...brief.registries.map((r) => ceilingFor([r.sourceId], index)),
  ];
  const counts: Record<LevelFilter, number> = { all: levels.length, established: 0, emerging: 0, uncertain: 0 };
  for (const l of levels) counts[l] += 1;
  return counts;
}

export function formatGenerated(iso: string): string | null {
  return formatSourceDate(iso);
}
