import { conditionBriefSchema, type ConditionBrief } from "@/lib/condition-brief/contract";

const at = "2026-10-20T09:00:00.000Z";

/** Synthetic brief for UI tests. Not real medical content. */
export const sampleBrief: ConditionBrief = conditionBriefSchema.parse({
  caseId: "11111111-1111-4111-8111-111111111111",
  diseaseName: "Synthetic Example Syndrome",
  version: 2,
  generatedAt: at,
  mode: "offline",
  sources: [
    { id: "orphanet:ORPHA:0001", kind: "orphanet", design: "reference_page", url: "https://www.orpha.net/example", title: "Synthetic Example Syndrome", publisher: "Orphanet", year: 2024, fetchedAt: at, excerpt: "Prevalence is listed as <b>1-9 / 1 000 000</b>." },
    { id: "pubmed:100001", kind: "pubmed", design: "narrative_review", url: "https://pubmed.ncbi.nlm.nih.gov/100001/", title: "A review of synthetic example syndrome", publisher: "Journal of Synthetic Medicine", year: 2021, fetchedAt: at },
    { id: "pubmed:100002", kind: "pubmed", design: "case_report", url: "https://pubmed.ncbi.nlm.nih.gov/100002/", title: "A single case of synthetic example syndrome", year: 2023, fetchedAt: at },
    { id: "ctgov:NCT00000001", kind: "ctgov", design: "trial_early", url: "https://clinicaltrials.gov/study/NCT00000001", title: "Phase 1 study of a synthetic compound", publisher: "Example University", year: 2025, fetchedAt: at },
    { id: "reporter:R01SYN000001", kind: "reporter", design: "grant", url: "https://reporter.nih.gov/project-details/1", title: "Mechanisms of synthetic example syndrome", year: 2024, fetchedAt: at },
    { id: "registry:synthetic-registry", kind: "registry", design: "registry", url: "https://example.org/registry", title: "Synthetic Example Registry", fetchedAt: at },
    { id: "genereviews:NBK000001", kind: "genereviews", design: "genereviews", url: "https://www.ncbi.nlm.nih.gov/books/NBK000001/", title: "Synthetic Example Syndrome - GeneReviews", year: 2022, fetchedAt: at },
  ],
  prevalence: [{ label: "1-9 / 1 000 000", prevalenceType: "Point prevalence", geography: "Worldwide", sourceId: "orphanet:ORPHA:0001" }],
  statements: [
    { id: "st-mech", section: "mechanism", text: "ESTABLISHED-MECH The condition involves a change in a synthetic pathway.", evidenceLevel: "established", sourceIds: ["genereviews:NBK000001"] },
    { id: "st-gen", section: "genetics", text: "EMERGING-GEN Variants in a synthetic gene are reported in some families.", evidenceLevel: "emerging", sourceIds: ["pubmed:100001"] },
    { id: "st-nat", section: "natural_history", text: "UNCERTAIN-NAT One report describes onset in adulthood.", evidenceLevel: "uncertain", sourceIds: ["pubmed:100002"] },
  ],
  studies: [
    { sourceId: "pubmed:100001", pmid: "100001", title: "A review of synthetic example syndrome", journal: "Journal of Synthetic Medicine", year: 2021, publicationTypes: ["Review"], kind: "review", evidenceLevel: "emerging" },
  ],
  research: [
    { sourceId: "ctgov:NCT00000001", kind: "trial", id: "NCT00000001", title: "Phase 1 study of a synthetic compound", status: "RECRUITING", phase: "PHASE1", sponsor: "Example University", evidenceLevel: "emerging" },
    { sourceId: "reporter:R01SYN000001", kind: "grant", id: "R01SYN000001", title: "Mechanisms of synthetic example syndrome", status: "2024", sponsor: "Example Institute", evidenceLevel: "emerging" },
  ],
  registries: [{ sourceId: "registry:synthetic-registry", name: "Synthetic Example Registry", url: "https://example.org/registry", description: "Collects information from people with the condition." }],
  questions: [
    { id: "q1", text: "What does the research say about how this condition usually changes over time?", statementIds: ["st-nat"] },
    { id: "q2", text: "Are there registries or studies that people with this condition can ask about?", statementIds: [] },
  ],
  dropped: [{ id: "x1", reason: "no fetched source" }, { id: "x2", reason: "advice wording" }],
}) satisfies ConditionBrief;

/** Same brief with every list emptied (still schema-valid). */
export const emptyBrief: ConditionBrief = conditionBriefSchema.parse({
  ...sampleBrief,
  sources: [],
  prevalence: [],
  statements: [],
  studies: [],
  research: [],
  registries: [],
  questions: [],
  dropped: [],
  mode: "live",
});
