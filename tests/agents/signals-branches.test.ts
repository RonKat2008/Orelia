import { describe, expect, it } from "vitest";
import { computeSignals, toCandidate, type SignalCase } from "@/lib/agents/signals";
import { deterministicUuid, type EvidenceWithId, type VerifiedRecord } from "@/lib/agents/verifier";
import type { Resource, TrialRegistry } from "@/lib/contracts";

type SourceKind = EvidenceWithId["sourceKind"];

const ev = (id: string, claimType: string, sourceKind: SourceKind, claim = "claim"): EvidenceWithId => ({
  id, claimType, claim, sourceKind, sourceUrl: `https://example.org/${id}`, fetchedAt: "2026-01-01T00:00:00.000Z",
});
const record = (resource: Resource, evidence: EvidenceWithId[]): VerifiedRecord => ({
  resource: { ...resource, id: deterministicUuid(resource.id) }, key: resource.id, evidence,
});
const baseCase: SignalCase = { diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600, goals: [] };

const registry = (over: Partial<TrialRegistry> = {}): TrialRegistry => ({
  conditions: ["Epithelioid Sarcoma"], keywords: [], meshTerms: [], stdAges: ["ADULT"], phases: ["PHASE2"],
  usSiteCount: 2, usRecruitingSiteCount: 2, recruitingSiteStates: ["AZ"], investigators: [], hasContact: true, ...over,
});
const trialRec = (over: Partial<TrialRegistry> = {}, title = "A study", withRegistry = true): VerifiedRecord =>
  record(
    { kind: "trial", id: "t", nctId: "NCT00000001", title, evidenceRefs: [], ...(withRegistry ? { registry: registry(over) } : {}) },
    [ev("t1", "trial_recruiting", "ctgov")],
  );

describe("trial signals", () => {
  it("returns no signals for a trial without registry facts", () => {
    expect(computeSignals(trialRec({}, "T", false), [], baseCase)).toEqual({});
  });

  it("scores a multi-condition (4 to 10) study 0.85 and describes it as a multi-condition study", () => {
    const s = computeSignals(trialRec({ conditions: ["Epithelioid Sarcoma", "A", "B", "C", "D"] }), [], baseCase);
    expect(s.subtypeExpertise!.value).toBe(0.85);
    expect(s.subtypeExpertise!.text).toMatch(/a multi-condition study/);
  });

  it("scores a keyword-only match 0.6 and a title-only match 0.4", () => {
    const kw = computeSignals(trialRec({ conditions: ["Other"], keywords: ["epithelioid sarcoma"] }), [], baseCase);
    const title = computeSignals(trialRec({ conditions: ["Other"] }, "Epithelioid sarcoma trial"), [], baseCase);
    expect(kw.subtypeExpertise).toMatchObject({ value: 0.6, text: expect.stringContaining("only in its keywords") });
    expect(title.subtypeExpertise).toMatchObject({ value: 0.4, text: expect.stringContaining("only in its title") });
  });

  it("omits the disease signal when the registry never names the disease", () => {
    const s = computeSignals(trialRec({ conditions: ["Other"] }), [], baseCase);
    expect(s.subtypeExpertise).toBeUndefined();
  });

  it("maps phase combinations to stage values and labels", () => {
    const val = (phases: string[]) => computeSignals(trialRec({ phases }), [], baseCase).institutionalFit!;
    expect(val(["PHASE2", "PHASE3"])).toMatchObject({ value: 1, text: "Registry stage: Phase 2/Phase 3." });
    expect(val([])).toMatchObject({ value: 0.5, text: "Registry stage: no phase listed." });
    // unknown phase token falls back to 0.5, known tokens to their own values
    expect(val(["MYSTERY"]).value).toBe(0.5);
    expect(val(["PHASE1", "PHASE3"]).value).toBe(1);
    expect(val(["MYSTERY", "PHASE1"]).value).toBe(0.5);
  });

  it("scores access from site count and nearest recruiting state, ignoring unknown states", () => {
    const near = computeSignals(trialRec({ recruitingSiteStates: ["AZ"], usRecruitingSiteCount: 3 }), [], baseCase).access!;
    expect(near.value).toBe(1);
    expect(near.text).toMatch(/in the home state \(AZ\)/);
    const far = computeSignals(trialRec({ recruitingSiteStates: ["ME"], usRecruitingSiteCount: 3 }), [], { ...baseCase, travelLimitMiles: 100 }).access!;
    expect(far.value).toBe(0.55);
    expect(far.text).toMatch(/miles \(state-to-state\) from AZ/);
    const unknown = computeSignals(trialRec({ recruitingSiteStates: ["ZZ"], usRecruitingSiteCount: 3 }), [], baseCase).access!;
    expect(unknown.value).toBe(0.5);
    expect(unknown.text).not.toMatch(/Nearest recruiting site/);
  });

  it("uses the default travel limit and describes a near non-home state when no limit is given", () => {
    const c: SignalCase = { diseaseName: "Epithelioid sarcoma", homeState: "AZ", goals: [] };
    const s = computeSignals(trialRec({ recruitingSiteStates: ["NM"], usRecruitingSiteCount: 3 }), [], c).access!;
    expect(s.value).toBeGreaterThan(0.5);
    expect(s.value).toBeLessThan(1);
  });

  it("falls back to 'home' in distance text when the case has no home state", () => {
    const c: SignalCase = { diseaseName: "Epithelioid sarcoma", goals: [] };
    const s = computeSignals(trialRec({ recruitingSiteStates: ["NM"] }), [], c).access!;
    expect(s.text).not.toMatch(/Nearest recruiting site/);
  });

  it("gives low access when no U.S. site is recruiting and a lower contactability without a central contact", () => {
    const s = computeSignals(trialRec({ usRecruitingSiteCount: 0, usSiteCount: 4, hasContact: false }), [], baseCase);
    expect(s.access).toMatchObject({ value: 0.1, text: "4 U.S. site(s) listed, none marked recruiting in the registry." });
    expect(s.contactability).toMatchObject({ value: 0.2 });
  });

  it("omits all trial signals that have no ctgov evidence behind them", () => {
    const bare = record({ kind: "trial", id: "t", nctId: "NCT1", title: "T", evidenceRefs: [], registry: registry() }, []);
    expect(computeSignals(bare, [], baseCase)).toEqual({});
  });
});

describe("expert signals", () => {
  const expertRec = (over: object = {}, evidence: EvidenceWithId[] = [ev("p1", "disease_publications", "pubmed")]) =>
    record({ kind: "expert", id: "e", name: "Ada Strong", npi: null, evidenceRefs: [], ...over } as Resource, evidence);

  it("produces no expertise or access signal for an expert with no profile and no led trials", () => {
    expect(computeSignals(expertRec(), [], baseCase)).toEqual({});
  });

  it("scores expertise from trials led alone, treating missing paper counts as zero", () => {
    const led = trialRec({ investigators: ["Ada Strong, MD"] });
    const e = expertRec();
    const s = computeSignals(e, [e, led], baseCase);
    // Documented-experience scoring (rd-experts): trials led alone are 1 of 2 for full credit at weight 0.2.
    expect(s.subtypeExpertise!.text).toMatch(/^Documented experience: overall official on 1 recruiting trial/);
    expect(s.subtypeExpertise!.value).toBe(0.1);
  });

  it("ignores led-trial evidence when other trials lack a registry or have different investigators", () => {
    const noRegistry = trialRec({}, "T", false);
    const other = trialRec({ investigators: ["Someone Else"] });
    const e = expertRec({ profile: { paperCount: 6, recentPaperCount: 3 } });
    const s = computeSignals(e, [e, noRegistry, other], baseCase);
    // 6 papers (0.4) + 3 recent (0.2); no led trials, no center designation.
    expect(s.subtypeExpertise!.value).toBe(0.6);
    expect(s.subtypeExpertise!.text).not.toMatch(/overall official/);
  });

  it("combines NCI affiliation and NPPES identity into institutional fit, citing both", () => {
    const nci = record(
      { kind: "institution", id: "i", name: "Example Cancer Institute", city: "Phoenix", state: "AZ", evidenceRefs: [] },
      [ev("n1", "nci_designation", "nci", "Example Cancer Institute is a Comprehensive Cancer Center")],
    );
    const e = expertRec(
      { verified: true, npi: "1", profile: { paperCount: 2, affiliation: "Example Cancer Institute, Phoenix, AZ", state: "AZ" } },
      [ev("p1", "disease_publications", "pubmed"), ev("id1", "identity_verified", "nppes", "NPI 1 active")],
    );
    const s = computeSignals(e, [e, nci], baseCase);
    expect(s.institutionalFit!.value).toBe(1);
    expect(s.institutionalFit!.text).toBe("NPI 1 active; paper affiliation matches Example Cancer Institute (Comprehensive Cancer Center).");
    expect(s.institutionalFit!.evidenceIds).toEqual(["id1", "n1", "p1"]);
    expect(s.contactability).toMatchObject({ value: 0.5, evidenceIds: ["id1"] });
    expect(s.access).toMatchObject({ value: 1 });
  });

  it("uses the default designation label when the NCI claim names no center type, and tolerates missing city/state", () => {
    const nci = record(
      { kind: "institution", id: "i", name: "Sample Oncology Institute", evidenceRefs: [] },
      [ev("n1", "nci_designation", "nci", "Listed center")],
    );
    const e = expertRec({ profile: { paperCount: 1, affiliation: "Sample Oncology Institute" } });
    const s = computeSignals(e, [e, nci, expertRec({ id: "x" })], baseCase);
    expect(s.institutionalFit!.text).toBe("paper affiliation matches Sample Oncology Institute (NCI-designated cancer center).");
    expect(s.institutionalFit!.value).toBe(0.6);
  });

  it("skips NCI evidence from non-institutions and institutions without NCI evidence", () => {
    const noNci = record({ kind: "institution", id: "i", name: "Sample Oncology Institute", evidenceRefs: [] }, [ev("w1", "disease_program", "exa")]);
    const e = expertRec({ profile: { paperCount: 1, affiliation: "Sample Oncology Institute" } });
    const s = computeSignals(e, [e, noNci], baseCase);
    expect(s.institutionalFit).toBeUndefined();
  });

  it("omits fit and contactability for an unverified expert and an unverified NPPES identity", () => {
    const e = expertRec({ verified: false, profile: { paperCount: 1 } }, [ev("p1", "disease_publications", "pubmed"), ev("id1", "identity_verified", "nppes")]);
    const s = computeSignals(e, [e], baseCase);
    expect(s.institutionalFit).toBeUndefined();
    expect(s.contactability).toBeUndefined();
  });

  it("omits contactability for a verified expert without NPPES identity evidence", () => {
    const e = expertRec({ verified: true, profile: { paperCount: 1 } });
    const s = computeSignals(e, [e], baseCase);
    expect(s.contactability).toBeUndefined();
    expect(s.institutionalFit).toBeUndefined();
  });

  it("gives access 0.1 for a distant state, omits it for an unknown state", () => {
    const far = expertRec({ profile: { paperCount: 1, state: "ME" } });
    const unknown = expertRec({ profile: { paperCount: 1, state: "ZZ" } });
    expect(computeSignals(far, [], { ...baseCase, travelLimitMiles: 100 }).access!.value).toBe(0.1);
    expect(computeSignals(unknown, [], baseCase).access).toBeUndefined();
  });
});

describe("institution signals", () => {
  const instRec = (evidence: EvidenceWithId[], over: object = {}) =>
    record({ kind: "institution", id: "i", name: "Example Hospital", city: "Phoenix", state: "AZ", evidenceRefs: [], ...over } as Resource, evidence);
  const program = (claim: string) => ev("w1", "disease_program", "exa", claim);

  it("rates a program page by how strongly it names the disease", () => {
    const exact = computeSignals(instRec([program("Epithelioid sarcoma clinic")]), [], baseCase);
    const family = computeSignals(instRec([program("Sarcoma clinic")]), [], baseCase);
    const none = computeSignals(instRec([program("General oncology")]), [], baseCase);
    expect(exact.subtypeExpertise).toMatchObject({ value: 1, text: expect.stringContaining("names the disease or its family") });
    expect(family.subtypeExpertise!.value).toBe(0.8);
    expect(none.subtypeExpertise).toMatchObject({ value: 0.5, text: expect.stringContaining("disease not named") });
    expect(exact.contactability).toMatchObject({ value: 0.6 });
  });

  it("falls back to a 0.4 NCI-only expertise and 0.3 contactability when there is no program page", () => {
    const s = computeSignals(instRec([ev("n1", "nci_designation", "nci", "Clinical Cancer Center")]), [], baseCase);
    expect(s.subtypeExpertise).toMatchObject({ value: 0.4 });
    expect(s.institutionalFit).toMatchObject({ value: 0.6, text: "Clinical designation from the NCI center list." });
    expect(s.contactability).toMatchObject({ value: 0.3 });
  });

  it("recognises Comprehensive designation and a generic NCI listing", () => {
    const comp = computeSignals(instRec([ev("n1", "nci_designation", "nci", "A comprehensive center")]), [], baseCase);
    const generic = computeSignals(instRec([ev("n1", "nci_designation", "nci", "Listed")]), [], baseCase);
    expect(comp.institutionalFit!.value).toBe(1);
    expect(generic.institutionalFit).toMatchObject({ value: 0.4, text: "NCI listing from the NCI center list." });
  });

  it("caps a self-reported designation at 0.8 and says it is stated on the center's own page", () => {
    const comp = computeSignals(instRec([program("We are a Comprehensive cancer program")]), [], baseCase);
    const clin = computeSignals(instRec([program("Clinical Cancer program")]), [], baseCase);
    expect(comp.institutionalFit).toMatchObject({ value: 0.8, text: "Comprehensive designation (stated on the center's own page)." });
    expect(clin.institutionalFit!.value).toBe(0.6);
  });

  it("omits designation when there is neither NCI nor designation text, and omits access without a known state", () => {
    const s = computeSignals(instRec([program("Plain page")], { state: undefined, city: undefined }), [], baseCase);
    expect(s.institutionalFit).toBeUndefined();
    expect(s.access).toBeUndefined();
  });

  it("omits expertise and contactability for an institution with neither NCI nor program evidence", () => {
    const s = computeSignals(instRec([ev("x1", "other", "exa", "text")]), [], baseCase);
    expect(s.subtypeExpertise).toBeUndefined();
    expect(s.contactability).toBeUndefined();
    expect(s.access!.text).toMatch(/^Phoenix, AZ: in the home state/);
  });

  it("writes access text without a city", () => {
    const s = computeSignals(instRec([program("Plain page")], { city: undefined, state: "NM" }), [], baseCase);
    expect(s.access!.text).toMatch(/^NM: about \d+ miles/);
  });
});

describe("organization signals", () => {
  const orgRec = (over: object, claims: string[]) =>
    record(
      { kind: "organization", id: "o", name: "Support Group", evidenceRefs: [], ...over } as Resource,
      claims.map((c, i) => ev(`o${i}`, "advocacy_organization", "exa", c)),
    );

  it("recognises family-level disease mentions", () => {
    const s = computeSignals(orgRec({}, ["Sarcoma support"]), [], baseCase);
    expect(s.subtypeExpertise).toMatchObject({ value: 0.6, text: "Disease-family: names the broader condition group." });
  });

  it("matches stated aid goals for financial and travel aid, and advocacy for the support goal", () => {
    const aid = computeSignals(orgRec({ organizationKind: "travel_aid" }, ["Help"]), [], { ...baseCase, goals: ["aid"] });
    const noAid = computeSignals(orgRec({ organizationKind: "financial_aid" }, ["Help"]), [], baseCase);
    const support = computeSignals(orgRec({ organizationKind: "advocacy" }, ["Help"]), [], { ...baseCase, goals: ["support"] });
    const unmatchedAdvocacy = computeSignals(orgRec({ organizationKind: "advocacy" }, ["Help"]), [], baseCase);
    expect(aid.institutionalFit).toMatchObject({ value: 1, text: "Matches a stated goal (financial/travel aid)." });
    expect(noAid.institutionalFit).toMatchObject({ value: 0.5, text: "Offers financial/travel aid; not a stated goal." });
    expect(support.institutionalFit).toMatchObject({ value: 1, text: "Matches a stated goal (advocacy and support)." });
    expect(unmatchedAdvocacy.institutionalFit!.value).toBe(0.5);
  });

  it("scores actionable pages higher on access and explicit contact paths higher on contactability", () => {
    const rich = computeSignals(orgRec({}, ["Apply for a travel grant by phone"]), [], baseCase);
    const plain = computeSignals(orgRec({ url: "https://example.org/" }, ["About our history"]), [], baseCase);
    const none = computeSignals(orgRec({}, ["About our history"]), [], baseCase);
    expect(rich.access).toMatchObject({ value: 0.8 });
    expect(rich.contactability).toMatchObject({ value: 1, text: "Page describes how to apply or make contact." });
    expect(plain.access).toMatchObject({ value: 0.4 });
    expect(plain.contactability).toMatchObject({ value: 0.6, text: "Website available; no explicit contact path found." });
    expect(none.contactability).toBeUndefined();
  });
});

describe("toCandidate", () => {
  it("wraps the record with its id and computed signals", () => {
    const t = trialRec();
    const cand = toCandidate(t, [t], baseCase);
    expect(cand.id).toBe(t.resource.id);
    expect(cand.record).toBe(t);
    expect(Object.keys(cand.signals ?? {}).sort()).toEqual(["access", "contactability", "institutionalFit", "subtypeExpertise"]);
  });
});
