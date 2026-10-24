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
});
