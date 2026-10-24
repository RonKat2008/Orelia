import { describe, expect, it } from "vitest";
import { resourceSchema } from "@/lib/contracts/resource";

describe("Resource", () => {
  it("parses each kind with evidence refs", () => {
    expect(resourceSchema.parse({ kind: "expert", id: "e1", name: "Ada Lovelace", evidenceRefs: ["ev1"] }).kind).toBe(
      "expert",
    );
    expect(
      resourceSchema.parse({
        kind: "institution",
        id: "i1",
        name: "Center",
        evidenceRefs: [],
      }).kind,
    ).toBe("institution");
    const trial = resourceSchema.parse({
      kind: "trial",
      id: "t1",
      nctId: "NCT00000001",
      title: "Study",
      evidenceRefs: [],
    });
    expect(trial.kind === "trial" && trial.nctId).toBe("NCT00000001");
    expect(
      resourceSchema.parse({ kind: "organization", id: "o1", name: "Aid org", evidenceRefs: ["ev2"] }).kind,
    ).toBe("organization");
  });

  it("rejects an unknown kind", () => {
    expect(resourceSchema.safeParse({ kind: "clinic", id: "x", name: "X", evidenceRefs: [] }).success).toBe(false);
  });

  it("expert accepts optional verified and profile; trial accepts optional registry", () => {
    const expert = resourceSchema.parse({
      kind: "expert", id: "e1", name: "Ada", npi: "1234567890", verified: true,
      profile: { paperCount: 3, recentPaperCount: 1, affiliation: "X", state: "AZ" }, evidenceRefs: [],
    });
    expect(expert.kind === "expert" && expert.verified).toBe(true);
    const registry = {
      conditions: ["A"], keywords: [], meshTerms: [], stdAges: ["ADULT"], phases: ["PHASE2"], usSiteCount: 2,
      usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], investigators: [], hasContact: true,
    };
    expect(resourceSchema.safeParse({ kind: "trial", id: "t", nctId: "NCT1", title: "T", registry, evidenceRefs: [] }).success).toBe(true);
    expect(resourceSchema.safeParse({ kind: "trial", id: "t", nctId: "NCT1", title: "T", registry: { conditions: [] }, evidenceRefs: [] }).success).toBe(false);
  });
});
