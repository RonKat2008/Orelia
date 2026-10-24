import { describe, expect, it } from "vitest";
import { assessTrial, enrollsAdults, mentionStrength } from "@/lib/agents/relevance";
import { verify } from "@/lib/agents/verifier";
import type { ResearchResult, TrialRegistry } from "@/lib/contracts";

const CASE = { diseaseName: "Epithelioid sarcoma", subtype: undefined };
const base: TrialRegistry = {
  conditions: ["Epithelioid Sarcoma"], keywords: [], meshTerms: [], stdAges: ["ADULT", "OLDER_ADULT"], minimumAge: "18 Years",
  phases: ["PHASE2"], usSiteCount: 1, usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], investigators: [], hasContact: true,
};
const trial = (title: string, registry: Partial<TrialRegistry>) => ({ title, registry: { ...base, ...registry } });

describe("disease relevance filter", () => {
  it("keeps a trial that lists the disease in its conditions", () => {
    expect(assessTrial(trial("A study", {}), CASE)).toEqual({ keep: true, match: "condition" });
  });

  it("keeps keyword-only and title-only matches but reports the weaker match", () => {
    expect(assessTrial(trial("Pembrolizumab", { conditions: ["Sarcoma"], keywords: ["Epithelioid sarcoma"] }), CASE).match).toBe("keyword");
    expect(assessTrial(trial("Epithelioid sarcoma registry", { conditions: ["Sarcoma"] }), CASE).match).toBe("title");
  });

  it("matches MeSH-inverted wording", () => {
    expect(assessTrial(trial("x", { conditions: ["Sarcoma"], meshTerms: ["Sarcoma, Epithelioid"] }), CASE).keep).toBe(true);
  });

  it.each([
    ["clonal hematopoiesis study listing only 'Sarcoma'", trial("Clonal Hematopoiesis Chemotherapy and Radiation Effects Study", { conditions: ["Solid Cancers", "Sarcoma"], keywords: ["clonal hematopoiesis"] })],
    ["uterine sarcoma study with 'Perivascular Epithelioid Cell Tumors'", trial("Elacestrant in ER Positive Uterine Sarcomas", { conditions: ["Uterine Sarcoma", "Perivascular Epithelioid Cell Tumors"] })],
    ["epithelioid hemangioendothelioma registry", trial("EHE Registry", { conditions: ["Epithelioid Hemangioendothelioma"] })],
  ])("drops off-target: %s", (_label, t) => {
    const verdict = assessTrial(t, CASE);
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toMatch(/^off-target/);
  });

  it("also accepts the subtype as a term", () => {
    const withSubtype = { diseaseName: "Sarcoma", subtype: "Epithelioid sarcoma" };
    expect(assessTrial(trial("x", { conditions: ["Epithelioid Sarcoma"] }), withSubtype).keep).toBe(true);
  });

  it("mentionStrength distinguishes exact, family and none", () => {
    expect(mentionStrength("Epithelioid sarcoma clinic", CASE)).toBe("exact");
    expect(mentionStrength("Sarcoma Alliance", CASE)).toBe("family");
    expect(mentionStrength("National Organization for Rare Disorders", CASE)).toBe("none");
  });
});

describe("adult scope filter", () => {
  it("requires ADULT in stdAges or a minimum age of 18 years or younger", () => {
    expect(enrollsAdults({ stdAges: ["ADULT"], minimumAge: undefined })).toBe(true);
    expect(enrollsAdults({ stdAges: ["CHILD"], minimumAge: "6 Months" })).toBe(true);
    expect(enrollsAdults({ stdAges: ["CHILD"], minimumAge: "18 Years" })).toBe(true);
    expect(enrollsAdults({ stdAges: ["CHILD"], minimumAge: "19 Years" })).toBe(false);
    expect(enrollsAdults({ stdAges: ["CHILD"] })).toBe(false);
    expect(enrollsAdults({ stdAges: [] })).toBeUndefined();
  });

  it("drops pediatric-only studies with a reason", () => {
    const v = assessTrial(trial("Kids study", { stdAges: ["CHILD"], minimumAge: "21 Years" }), CASE);
    expect(v).toEqual({ keep: false, reason: "out of scope: does not enroll adults (pediatric only)" });
  });

  it("drops studies that list ADULT but are pediatric-focused, and keeps adult-and-pediatric ones", () => {
    expect(assessTrial(trial("A Study in Pediatric Patients", { stdAges: ["CHILD", "ADULT"], minimumAge: "12 Years" }), CASE).reason).toMatch(/pediatric-focused/);
    expect(assessTrial(trial("Adult and pediatric patients", { stdAges: ["CHILD", "ADULT"] }), CASE).keep).toBe(true);
  });

  it("drops a trial whose age eligibility is not stated", () => {
    expect(assessTrial(trial("x", { stdAges: [], minimumAge: undefined }), CASE).reason).toMatch(/not stated/);
  });
});

describe("verifier applies the filters and records every drop", () => {
  const ev = (url: string) => ({ claimType: "trial_recruiting", claim: "c", sourceUrl: url, sourceKind: "ctgov" as const, fetchedAt: "2026-01-01T00:00:00.000Z" });
  const result = (id: string, title: string, registry?: TrialRegistry): ResearchResult => ({
    status: "ok",
    records: [{ kind: "trial", id: `trial:${id}`, nctId: id, title, ...(registry ? { registry } : {}), evidenceRefs: [`https://x/${id}`] }],
    evidence: [ev(`https://x/${id}`)],
  });

  it("drops off-target and pediatric trials with reasons; keeps good and unassessable ones", () => {
    const out = verify(
      [
        result("NCT00000001", "Good", base),
        result("NCT00000002", "Uterine", { ...base, conditions: ["Uterine Sarcoma"] }),
        result("NCT00000003", "Kids", { ...base, stdAges: ["CHILD"], minimumAge: "21 Years" }),
        result("NCT00000004", "No registry facts"),
      ],
      CASE,
    );
    expect(out.kept.map((k) => (k.resource.kind === "trial" ? k.resource.nctId : "")).sort()).toEqual(["NCT00000001", "NCT00000004"]);
    expect(out.dropped.map((d) => d.reason)).toEqual([
      expect.stringMatching(/^off-target/),
      expect.stringMatching(/pediatric only/),
    ]);
    expect(out.dropped.every((d) => d.type === "record")).toBe(true);
  });

  it("does not filter when no case context is given", () => {
    expect(verify([result("NCT00000002", "Uterine", { ...base, conditions: ["Uterine Sarcoma"] })]).kept).toHaveLength(1);
  });
});
