import { describe, expect, it } from "vitest";
import { evidenceSchema } from "@/lib/contracts/evidence";

const valid = {
  claimType: "publication",
  claim: "14 papers on this disease since 2021",
  sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
  sourceKind: "pubmed",
  fetchedAt: "2026-10-24T00:00:00.000Z",
};

describe("Evidence", () => {
  it("parses a sourced claim", () => {
    expect(evidenceSchema.parse(valid).sourceKind).toBe("pubmed");
  });

  it("rejects evidence without sourceUrl", () => {
    const missing = { ...valid, sourceUrl: undefined };
    expect(evidenceSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects an unknown source kind", () => {
    expect(evidenceSchema.safeParse({ ...valid, sourceKind: "model" }).success).toBe(false);
  });
});
