import { describe, expect, it } from "vitest";
import { documentedExperience, EXPERIENCE_WEIGHTS } from "@/lib/experts/experience";
import { deterministicUuid, type VerifiedRecord } from "@/lib/agents/verifier";
import type { Resource } from "@/lib/contracts";
import { rank } from "@/lib/ranking/rank";

const ev = (id: string, claimType: string, sourceKind: "pubmed" | "nppes" | "ctgov" | "nci" | "exa", claim = "claim") =>
  ({ id, claimType, claim, sourceKind, sourceUrl: `https://example.org/${id}`, fetchedAt: "2026-01-01T00:00:00.000Z" });
const record = (resource: Resource, evidence: ReturnType<typeof ev>[]): VerifiedRecord => ({
  resource: { ...resource, id: deterministicUuid(resource.id) }, key: resource.id, evidence,
});
const c = { diseaseName: "Epithelioid sarcoma" };
type Expert = Extract<Resource, { kind: "expert" }>;
const expertRec = (profile: Expert["profile"], evidence = [ev("p1", "disease_publications", "pubmed")]) =>
  record({ kind: "expert", id: "e", name: "Fugen Li", npi: null, profile, evidenceRefs: [] }, evidence);
const trialRec = (investigators: string[]) =>
  record({ kind: "trial", id: "t", nctId: "NCT00000001", title: "T", evidenceRefs: [], registry: {
    conditions: ["Epithelioid Sarcoma"], keywords: [], meshTerms: [], stdAges: ["ADULT"], phases: ["PHASE2"], usSiteCount: 1,
    usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], investigators, hasContact: true } }, [ev("t1", "trial_recruiting", "ctgov")]);
const center = (name: string, designation: string, extra: Partial<Extract<Resource, { kind: "institution" }>> = {}, src: "nci" | "exa" = "nci") =>
  record({ kind: "institution", id: name, name, city: "X", state: "AZ", evidenceRefs: [], ...extra }, [ev("c-" + name.length, "nci_designation", src, `${name} — ${designation}, X, AZ.`)]);
const run = (r: VerifiedRecord, all: VerifiedRecord[] = [r]) => documentedExperience(r.resource as Expert, r, all, c);
const comp = (d: ReturnType<typeof run>, key: string) => d.components.find((k) => k.key === key)!;

describe("documentedExperience", () => {
  it("weights sum to 1", () => {
    expect(Object.values(EXPERIENCE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("scores papers and recency from the profile, citing only pubmed rows", () => {
    const d = run(expertRec({ paperCount: 3, recentPaperCount: 1 }));
    expect(comp(d, "disease_papers")).toMatchObject({ value: 0.5, evidenceIds: ["p1"] });
    expect(comp(d, "recency").value).toBe(0.33);
    expect(d.text).toBe("Documented experience: 3 PubMed papers on Epithelioid sarcoma in the retrieved set (1 in the last 5 years).");
    expect(d.value).toBeCloseTo(0.4 * 0.5 + 0.2 * 0.33, 1);
  });

  it("saturates at the full-score thresholds", () => {
    const d = run(expertRec({ paperCount: 50, recentPaperCount: 40 }));
    expect(comp(d, "disease_papers").value).toBe(1);
    expect(comp(d, "recency").value).toBe(1);
  });

  it("missing evidence scores 0 and invents no ids, even when the profile claims counts", () => {
    const d = run(expertRec({ paperCount: 9, recentPaperCount: 9 }, []));
    expect(d.value).toBe(0);
    expect(d.evidenceIds).toEqual([]);
    expect(d.text).toBe("");
    for (const k of d.components) expect(k).toMatchObject({ value: 0, evidenceIds: [] });
  });

  it("trials led: matches overall officials and cites ctgov rows only", () => {
    const e = expertRec({ paperCount: 1 });
    const d = run(e, [e, trialRec(["Fugen Li, MD"])]);
    expect(comp(d, "trials_led")).toMatchObject({ value: 0.5, evidenceIds: ["t1"] });
    expect(d.text).toMatch(/overall official on 1 recruiting trial/);
    expect(run(e, [e, trialRec(["Someone Else"])]).evidenceIds).toEqual(["p1"]);
  });

  it("center designation tiers: Comprehensive > Clinical > other NCI, with nci evidence only", () => {
    const aff = { paperCount: 1, affiliation: "Mayo Clinic Arizona, Phoenix" };
    const value = (designation: string) => {
      const e = expertRec(aff);
      return comp(run(e, [e, center("Mayo Clinic Arizona", designation)]), "center_designation");
    };
    const comprehensive = value("Comprehensive Cancer Center");
    expect(comprehensive.value).toBe(1);
    expect(comprehensive.evidenceIds.every((id) => id.startsWith("c-"))).toBe(true);
    expect(value("Clinical Cancer Center").value).toBeLessThan(comprehensive.value);
    expect(value("Basic Laboratory Cancer Center").value).toBeLessThan(value("Clinical Cancer Center").value);
    expect(value("Basic Laboratory Cancer Center").value).toBeGreaterThan(0);
  });

  it("rare-disease-center institutions count; an unmatched affiliation does not", () => {
    const e = expertRec({ paperCount: 1, affiliation: "Vascular Genetics Clinic, Ohio" });
    const rare = center("Vascular Genetics Clinic", "", { institutionKind: "rare_disease_center" }, "exa");
    const d = run(e, [e, rare]);
    expect(comp(d, "center_designation").value).toBe(0.7);
    expect(d.text).toMatch(/affiliation matches Vascular Genetics Clinic \(rare-disease center\)/);
    const none = expertRec({ paperCount: 1, affiliation: "Unrelated Hospital, Ohio" });
    expect(comp(run(none, [none, rare]), "center_designation")).toMatchObject({ value: 0, evidenceIds: [] });
  });

  it("all component ids are a subset of the combined ids", () => {
    const e = expertRec({ paperCount: 2, recentPaperCount: 1, affiliation: "Mayo Clinic Arizona" });
    const d = run(e, [e, trialRec(["Fugen Li"]), center("Mayo Clinic Arizona", "Comprehensive Cancer Center")]);
    for (const k of d.components) for (const id of k.evidenceIds) expect(d.evidenceIds).toContain(id);
    expect(d.evidenceIds).toEqual([...d.evidenceIds].sort());
  });
});

describe("rank() components passthrough", () => {
  const sig = { value: 0.6, text: "Documented experience: x.", evidenceIds: ["b", "a", "a"], components: [
    { key: "disease_papers", label: "Papers", value: 0.5, weight: 0.4, detail: "d", evidenceIds: ["b", "a", "a", "forged"] },
    { key: "trials_led", label: "Trials", value: 0, weight: 0.2, detail: "d", evidenceIds: [] },
  ] };

  it("passes components for supported factors with sorted, deduped, subset ids and derived points", () => {
    const [r] = rank([{ id: "x", signals: { subtypeExpertise: sig } }]);
    const item = r!.breakdown.find((b) => b.factor === "subtypeExpertise")!;
    expect(item.evidenceIds).toEqual(["a", "b"]);
    expect(item.components![0]).toEqual({ key: "disease_papers", label: "Papers", value: 0.5, points: 10, detail: "d", evidenceIds: ["a", "b"] });
    expect(item.components![1]!.evidenceIds).toEqual([]);
  });

  it("omits components for unsupported factors and when none are given", () => {
    const [r] = rank([{ id: "x", signals: { subtypeExpertise: { ...sig, evidenceIds: [] }, access: { value: 1, text: "t", evidenceIds: ["e"] } } }]);
    expect(r!.breakdown.find((b) => b.factor === "subtypeExpertise")).not.toHaveProperty("components");
    expect(r!.breakdown.find((b) => b.factor === "access")).not.toHaveProperty("components");
  });
});
