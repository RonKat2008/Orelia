import { describe, expect, it } from "vitest";
import type { Resource } from "@/lib/contracts";
import { expertEligibility } from "@/lib/identity/eligibility";

const expert = (papers: number): Extract<Resource, { kind: "expert" }> => ({ kind: "expert", id: "e", name: "Jane A Smith", npi: "1234567890", verified: true, profile: { paperCount: papers }, evidenceRefs: [] });
const trial = (name: string): Resource => ({ kind: "trial", id: "t", nctId: "NCT12345678", title: "Sarcoma study", evidenceRefs: [], registry: { conditions: ["sarcoma"], keywords: [], meshTerms: [], stdAges: ["ADULT"], phases: [], usSiteCount: 1, usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], investigators: [name], hasContact: true } });

describe("expert shortlist eligibility", () => {
  it("requires at least two papers or one plus trial leadership", () => {
    expect(expertEligibility(expert(2), []).eligible).toBe(true);
    expect(expertEligibility(expert(1), []).eligible).toBe(false);
    expect(expertEligibility(expert(1), [trial("Jane A Smith, MD")]).eligible).toBe(true);
    expect(expertEligibility(expert(0), [trial("Jane A Smith")]).eligible).toBe(false);
  });
  it("never shortlists an unverified identity or a conflicting/initial-only trial lead", () => {
    expect(expertEligibility({ ...expert(10), verified: false, npi: null }, []).eligible).toBe(false);
    for (const name of ["Jane B Smith", "J A Smith", "Other Jane Smith"]) {
      expect(expertEligibility(expert(1), [trial(name)]).eligible).toBe(false);
    }
  });
});
