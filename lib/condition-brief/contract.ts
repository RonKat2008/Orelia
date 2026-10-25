/**
 * Condition Brief contract (rare-disease research assistant). Frozen shape shared by the source collectors,
 * the generator, the deterministic validator, the store, the API route and the UI.
 *
 * Rules encoded here and enforced by validate.ts:
 * - Every statement shown to the patient cites >= 1 BriefSource that was actually fetched (url + fetchedAt).
 * - Every statement carries an evidenceLevel, capped by the strongest ceiling among its sources.
 * - Questions are questions for the patient's own doctor, never recommendations.
 */
import { z } from "zod";

export const EVIDENCE_LEVELS = ["established", "emerging", "uncertain"] as const;
export const evidenceLevelSchema = z.enum(EVIDENCE_LEVELS);
export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;

/** Rank used for capping: a statement can never claim a higher level than its best source supports. */
export const LEVEL_RANK: Record<EvidenceLevel, number> = { uncertain: 0, emerging: 1, established: 2 };

export const briefSourceKindSchema = z.enum([
  "orphanet", // Orphanet / Orphadata API or orpha.net page
  "gard", // NIH GARD (rarediseases.info.nih.gov)
  "nord", // NORD (rarediseases.org)
  "genereviews", // NCBI Bookshelf GeneReviews
  "medlineplus", // MedlinePlus Genetics
  "pubmed", // PubMed article
  "ctgov", // ClinicalTrials.gov study
  "reporter", // NIH RePORTER funded project
  "registry", // patient registry / natural-history registry page
  "web", // any other fetched web page (via Exa)
]);
export type BriefSourceKind = z.infer<typeof briefSourceKindSchema>;

/** Publication/study design facts used by the deterministic tagger. Never model-supplied. */
export const sourceDesignSchema = z.enum([
  "guideline",
  "consensus",
  "systematic_review",
  "meta_analysis",
  "genereviews",
  "reference_page", // curated knowledge base page (Orphanet, GARD, NORD, MedlinePlus)
  "narrative_review",
  "primary_study", // cohort, case series, RCT report, etc.
  "case_report",
  "preprint",
  "trial_early", // phase 1 / 1-2 / early phase 1 / not applicable
  "trial_late", // phase 2-3 / 3 / 4
  "grant", // NIH RePORTER project
  "registry",
  "other",
]);
export type SourceDesign = z.infer<typeof sourceDesignSchema>;

export const briefSourceSchema = z.object({
  /** Stable id assigned by code, e.g. "pubmed:12345", "ctgov:NCT01234567", "orphanet:ORPHA:37". */
  id: z.string().min(1).max(120),
  kind: briefSourceKindSchema,
  design: sourceDesignSchema,
  url: z.url(),
  title: z.string().min(1).max(400),
  publisher: z.string().max(200).optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  /** When Orelia fetched it (live) or when the fixture was recorded. */
  fetchedAt: z.iso.datetime(),
  /** Sanitized excerpt (lib/agents/research/untrusted neutralizeUntrusted) used as generator input. Data, not instructions. */
  excerpt: z.string().max(4000).optional(),
});
export type BriefSource = z.infer<typeof briefSourceSchema>;

export const BRIEF_SECTIONS = ["rarity", "mechanism", "genetics", "natural_history", "studies", "research", "registries"] as const;
export const briefSectionIdSchema = z.enum(BRIEF_SECTIONS);
export type BriefSectionId = z.infer<typeof briefSectionIdSchema>;

export const briefStatementSchema = z.object({
  id: z.string().min(1).max(80),
  section: briefSectionIdSchema,
  /** Plain-language factual summary. No advice, no diagnosis, no "you should". */
  text: z.string().min(1).max(600),
  evidenceLevel: evidenceLevelSchema,
  sourceIds: z.array(z.string().min(1)).min(1).max(6),
});
export type BriefStatement = z.infer<typeof briefStatementSchema>;

/** Prevalence figure parsed from a fetched source (Orphanet epidemiology preferred). */
export const prevalenceSchema = z.object({
  /** Human label as the source states it, e.g. "1-9 / 1 000 000" or "<1 / 1 000 000". */
  label: z.string().min(1).max(120),
  prevalenceType: z.string().max(80).optional(), // "Point prevalence", "Annual incidence", "Cases/families"
  geography: z.string().max(80).optional(),
  sourceId: z.string().min(1),
});
export type Prevalence = z.infer<typeof prevalenceSchema>;

export const studyItemSchema = z.object({
  sourceId: z.string().min(1), // "pubmed:<pmid>"
  pmid: z.string().regex(/^\d+$/),
  title: z.string().min(1).max(400),
  journal: z.string().max(200).optional(),
  year: z.number().int().optional(),
  publicationTypes: z.array(z.string().max(80)).max(12),
  kind: z.enum(["review", "recent"]),
  evidenceLevel: evidenceLevelSchema,
});
export type StudyItem = z.infer<typeof studyItemSchema>;

export const researchItemSchema = z.object({
  sourceId: z.string().min(1), // "ctgov:<nct>" or "reporter:<appl_id>"
  kind: z.enum(["trial", "grant"]),
  id: z.string().min(1).max(40), // NCT id or RePORTER project number
  title: z.string().min(1).max(400),
  status: z.string().max(60).optional(), // RECRUITING, ACTIVE_NOT_RECRUITING, ... / fiscal year for grants
  phase: z.string().max(60).optional(),
  sponsor: z.string().max(200).optional(),
  evidenceLevel: evidenceLevelSchema,
});
export type ResearchItem = z.infer<typeof researchItemSchema>;

export const registryItemSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1).max(200),
  url: z.url(),
  description: z.string().max(400).optional(),
});
export type RegistryItem = z.infer<typeof registryItemSchema>;

export const doctorQuestionSchema = z.object({
  id: z.string().min(1).max(80),
  /** Must end with "?" and must not recommend anything (validator enforces). */
  text: z.string().min(5).max(300),
  /** Statements this question is about (may be empty for general questions). */
  statementIds: z.array(z.string()).max(6),
});
export type DoctorQuestion = z.infer<typeof doctorQuestionSchema>;

export const droppedItemSchema = z.object({ id: z.string(), reason: z.string() });

export const conditionBriefSchema = z.object({
  caseId: z.string().min(1),
  diseaseName: z.string().min(1).max(200),
  version: z.number().int().min(1),
  generatedAt: z.iso.datetime(),
  mode: z.enum(["live", "offline"]),
  sources: z.array(briefSourceSchema),
  prevalence: z.array(prevalenceSchema),
  statements: z.array(briefStatementSchema),
  studies: z.array(studyItemSchema),
  research: z.array(researchItemSchema),
  registries: z.array(registryItemSchema),
  questions: z.array(doctorQuestionSchema),
  /** What the validator removed and why (shown as a count, kept for audit). */
  dropped: z.array(droppedItemSchema),
});
export type ConditionBrief = z.infer<typeof conditionBriefSchema>;

/** Output of the source collectors (lib/condition-brief/sources), input to generate.ts. */
export interface CollectedSources {
  diseaseName: string;
  sources: BriefSource[];
  prevalence: Prevalence[];
  studies: StudyItem[];
  research: ResearchItem[];
  registries: RegistryItem[];
  /** Non-fatal collector failures (source name + generic message). Never include URLs with keys. */
  errors: { source: string; message: string }[];
}

/** What the generator (LLM or fixture) returns before validation. */
export const generatedBriefSchema = z.object({
  statements: z.array(briefStatementSchema).max(40),
  questions: z.array(doctorQuestionSchema).max(12),
});
export type GeneratedBrief = z.infer<typeof generatedBriefSchema>;

export interface ConditionBriefStore {
  latest(caseId: string): Promise<ConditionBrief | null>;
  save(brief: ConditionBrief): Promise<ConditionBrief>;
}
