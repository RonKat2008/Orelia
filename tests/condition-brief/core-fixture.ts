import type { BriefSource, CollectedSources } from "@/lib/condition-brief/contract";

export const FETCHED = "2026-01-15T00:00:00.000Z";

export function src(id: string, kind: BriefSource["kind"], design: BriefSource["design"], extra: Partial<BriefSource> = {}): BriefSource {
  return { id, kind, design, url: `https://example.org/${encodeURIComponent(id)}`, title: `Synthetic ${id}`, fetchedAt: FETCHED, ...extra };
}

export function collected(overrides: Partial<CollectedSources> = {}): CollectedSources {
  return {
    diseaseName: "Synthetic disease",
    sources: [
      src("orphanet:1", "orphanet", "reference_page"),
      src("pubmed:111", "pubmed", "case_report"),
      src("pubmed:222", "pubmed", "narrative_review"),
      src("pubmed:333", "pubmed", "systematic_review"),
      src("ctgov:NCT00000001", "ctgov", "trial_early"),
      src("registry:r1", "registry", "registry"),
    ],
    prevalence: [{ label: "<1 / 1 000 000", sourceId: "orphanet:1" }],
    studies: [{ sourceId: "pubmed:333", pmid: "333", title: "A review", publicationTypes: ["Systematic Review"], kind: "review", evidenceLevel: "established" }],
    research: [{ sourceId: "ctgov:NCT00000001", kind: "trial", id: "NCT00000001", title: "A trial", evidenceLevel: "established" }],
    registries: [{ sourceId: "registry:r1", name: "Synthetic registry", url: "https://example.org/registry" }],
    errors: [],
    ...overrides,
  };
}

export const stmt = (id: string, sourceIds: string[], extra: Record<string, unknown> = {}) => ({
  id, section: "mechanism", text: `Synthetic factual statement ${id}.`, evidenceLevel: "established", sourceIds, ...extra,
});
