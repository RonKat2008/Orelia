import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { affiliationEvidence, parseAffiliationEvidence, sanitizeAffiliation, AFFILIATION_CLAIM_TYPE } from "@/lib/identity/affiliation-evidence";
import { PAPER_CLAIM_TYPE, parsePaperEvidence } from "@/lib/identity/paper-evidence";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { literatureAgent } from "@/lib/agents/research/literature";
import { finalizeOutput, ProvenanceTracker } from "@/lib/agents/research/shared";
import { MemoryRunStore } from "@/lib/agents/run-store";

const AT = "2026-01-01T00:00:00.000Z";

describe("identity.affiliation evidence", () => {
  it("sanitizes affiliation text: no e-mail addresses, capped, trimmed", () => {
    expect(sanitizeAffiliation("Department of Genetics, Example University, Portland, OR, USA. Electronic address: jane.doe@example.edu."))
      .toBe("Department of Genetics, Example University, Portland, OR, USA");
    expect(sanitizeAffiliation("Example University jane@x.org, Portland")).toBe("Example University, Portland");
    expect(sanitizeAffiliation("   ")).toBeNull();
    expect(sanitizeAffiliation(undefined)).toBeNull();
    expect(sanitizeAffiliation("x".repeat(900))!.length).toBeLessThanOrEqual(300);
  });

  it("builds a row whose source is the PubMed record and parses it back", () => {
    const row = affiliationEvidence({ name: "Ada Example", pmid: "123", affiliation: "Example University, Portland, OR", fetchedAt: AT })!;
    expect(row).toMatchObject({ claimType: AFFILIATION_CLAIM_TYPE, sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/123/", sourceKind: "pubmed" });
    expect(row.id).toMatch(/^aff:/);
    expect(parseAffiliationEvidence(row)).toEqual({ pmid: "123", affiliation: "Example University, Portland, OR" });
  });

  it("refuses rows with a mismatched PMID, wrong source kind or claim type", () => {
    const row = affiliationEvidence({ name: "Ada Example", pmid: "123", affiliation: "Example University", fetchedAt: AT })!;
    expect(parseAffiliationEvidence({ ...row, sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/999/" })).toBeNull();
    expect(parseAffiliationEvidence({ ...row, sourceKind: "exa" })).toBeNull();
    expect(parseAffiliationEvidence({ ...row, claimType: "disease_publications" })).toBeNull();
  });

  it("never accepts a model-written identity.affiliation row", () => {
    const tracker = new ProvenanceTracker(() => new Date(AT));
    tracker.collect("pubmed", { sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/123/", name: "Ada Example" });
    const out = finalizeOutput({
      records: [{ kind: "expert", id: "expert:ada-example", name: "Ada Example", evidenceRefs: ["https://pubmed.ncbi.nlm.nih.gov/123/"] }],
      evidence: [{ claimType: "identity.affiliation", claim: "Ada Example's listed affiliation on PMID 123: Fake Clinic", sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/123/" }],
    }, tracker, { allowedKinds: ["expert"] });
    expect(out.evidence.filter((e) => e.claimType === "identity.affiliation")).toEqual([]);
  });
});

describe("literature agent stamps affiliations from the PubMed tool record (offline fixtures)", () => {
  beforeEach(() => vi.stubEnv("WAYFINDER_OFFLINE", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("adds identity.affiliation rows cited by the expert record", async () => {
    const result = await literatureAgent.run({ diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", goals: ["second_opinion"] }, { ports: createFixturePorts(), store: new MemoryRunStore(), caseId: "c" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const aff = result.evidence.filter((e) => e.claimType === AFFILIATION_CLAIM_TYPE);
    expect(aff.length).toBeGreaterThan(0);
    for (const row of aff) {
      expect(row.sourceKind).toBe("pubmed");
      expect(parseAffiliationEvidence(row)).not.toBeNull();
      expect(row.claim).not.toMatch(/@/);
      expect(result.records.some((r) => r.evidenceRefs.includes(row.id!))).toBe(true);
    }
  });
});

describe("literature agent stamps real paper citations (offline fixtures)", () => {
  beforeEach(() => vi.stubEnv("WAYFINDER_OFFLINE", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("adds publication.citation rows with a real title, cited by the expert record", async () => {
    const result = await literatureAgent.run({ diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", goals: ["second_opinion"] }, { ports: createFixturePorts(), store: new MemoryRunStore(), caseId: "c" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const rows = result.evidence.filter((e) => e.claimType === PAPER_CLAIM_TYPE);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const paper = parsePaperEvidence(row)!;
      expect(paper.title.length).toBeGreaterThan(5);
      expect(paper.title).not.toMatch(/^PubMed article/);
      expect(result.records.some((r) => r.evidenceRefs.includes(row.id!))).toBe(true);
    }
    expect(rows.some((r) => parsePaperEvidence(r)?.journal)).toBe(true);
  });

  it("never accepts a model-written publication.citation row", () => {
    const tracker = new ProvenanceTracker(() => new Date(AT));
    tracker.collect("pubmed", { sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/123/", name: "Ada Example" });
    const out = finalizeOutput({
      records: [{ kind: "expert", id: "expert:ada-example", name: "Ada Example", evidenceRefs: ["https://pubmed.ncbi.nlm.nih.gov/123/"] }],
      evidence: [{ claimType: PAPER_CLAIM_TYPE, claim: 'PMID 123 is titled "Fake".', sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/123/" }],
    }, tracker, { allowedKinds: ["expert"] });
    expect(out.evidence.filter((e) => e.claimType === PAPER_CLAIM_TYPE)).toEqual([]);
  });
});
