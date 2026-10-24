import { describe, expect, it } from "vitest";
import { ProvenanceTracker, finalizeOutput, type ResearchOutput } from "@/lib/agents/research/shared";
import { registryFacts } from "@/lib/agents/research/trials";

const URL_A = "https://pubmed.ncbi.nlm.nih.gov/1/";

function tracker() {
  const t = new ProvenanceTracker(() => new Date("2026-01-01T00:00:00Z"));
  t.collect("pubmed", { authors: [{ name: "Ada Lee", papers: [{ pmid: "1", sourceUrl: URL_A }] }, { name: "Bo Kim", papers: [{ pmid: "1", sourceUrl: URL_A }] }] });
  return t;
}

describe("finalizeOutput evidence ids", () => {
  const raw: ResearchOutput = {
    records: [
      { kind: "expert", id: "e:a", name: "Ada Lee", evidenceRefs: ["lit:ada:1"] },
      { kind: "expert", id: "e:b", name: "Bo Kim", evidenceRefs: ["lit:bo:1"] },
    ],
    evidence: [
      { id: "lit:ada:1", claimType: "disease_publications", claim: "Ada Lee is an author of PMID 1", sourceUrl: URL_A },
      { id: "lit:bo:1", claimType: "disease_publications", claim: "Bo Kim is an author of PMID 1", sourceUrl: URL_A },
    ],
  };

  it("a record citing an evidence id gets only that claim, not every claim at the same URL", () => {
    const { records, evidence } = finalizeOutput(raw, tracker(), { allowedKinds: ["expert"] });
    expect(records.map((r) => r.evidenceRefs)).toEqual([["lit:ada:1"], ["lit:bo:1"]]);
    expect(evidence.map((e) => e.id)).toEqual(["lit:ada:1", "lit:bo:1"]);
  });

  it("URL refs still cite every claim at that URL (backwards compatible)", () => {
    const urlRaw: ResearchOutput = { ...raw, records: [{ kind: "expert", id: "e:a", name: "Ada Lee", evidenceRefs: [URL_A] }] };
    expect(finalizeOutput(urlRaw, tracker(), { allowedKinds: ["expert"] }).evidence).toHaveLength(2);
  });
});

describe("finalizeOutput stamps code-sourced facts", () => {
  it("verified is true only for a tracker-verified NPI; model-supplied verified/profile are discarded", () => {
    const t = tracker();
    t.allowVerifiedNpi("1111111111");
    t.rememberAuthor("Ada Lee", { paperCount: 4, recentPaperCount: 2, state: "AZ" });
    const raw: ResearchOutput = {
      records: [
        { kind: "expert", id: "a", name: "Ada Lee", npi: "1111111111", verified: true, evidenceRefs: [URL_A] },
        { kind: "expert", id: "b", name: "Bo Kim", npi: "2222222222", verified: true, profile: { paperCount: 99 }, evidenceRefs: [URL_A] },
      ],
      evidence: [{ claimType: "x", claim: "c", sourceUrl: URL_A }],
    };
    const [a, b] = finalizeOutput(raw, t, { allowedKinds: ["expert"] }).records;
    expect(a).toMatchObject({ npi: "1111111111", verified: true, profile: { paperCount: 4, recentPaperCount: 2, state: "AZ" } });
    expect(b?.kind === "expert" && b.npi).toBeNull();
    expect(b).not.toHaveProperty("verified");
    expect(b).not.toHaveProperty("profile");
  });

  it("trial registry comes from the tool output, not the model", () => {
    const t = tracker();
    const registry = registryFacts(
      {
        nctId: "NCT00000001", title: "T", status: "RECRUITING", phases: ["PHASE2"], conditions: ["Epithelioid Sarcoma"], stdAges: ["ADULT"], hasContact: true,
        sites: [{ state: "Arizona", country: "United States", status: "RECRUITING" }, { state: "Utah", country: "United States", status: "COMPLETED" }],
      },
      [{ state: "Arizona", country: "United States", status: "RECRUITING" }, { state: "Utah", country: "United States", status: "COMPLETED" }],
    );
    expect(registry).toMatchObject({ usSiteCount: 2, usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], hasContact: true });
    t.rememberTrial("NCT00000001", registry);
    const raw: ResearchOutput = {
      records: [{ kind: "trial", id: "t", nctId: "NCT00000001", title: "T", evidenceRefs: [URL_A] }],
      evidence: [{ claimType: "x", claim: "c", sourceUrl: URL_A }],
    };
    const [rec] = finalizeOutput(raw, t, { allowedKinds: ["trial"] }).records;
    expect(rec?.kind === "trial" && rec.registry).toEqual(registry);
  });
});
