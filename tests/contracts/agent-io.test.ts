import { describe, expect, it } from "vitest";
import {
  agentNameSchema,
  agentRunStatusSchema,
  researchResultSchema,
  scoreBreakdownItemSchema,
} from "@/lib/contracts/agent-io";

describe("agent I/O", () => {
  it("accepts the nine research agents and run statuses", () => {
    expect(agentNameSchema.options).toHaveLength(9);
    expect(agentNameSchema.parse("contact_finder")).toBe("contact_finder");
    expect(agentRunStatusSchema.parse("not_implemented")).toBe("not_implemented");
  });

  it("parses each research result variant", () => {
    expect(researchResultSchema.parse({ status: "not_implemented" }).status).toBe("not_implemented");
    expect(researchResultSchema.parse({ status: "error", message: "timeout" }).status).toBe("error");
    expect(
      researchResultSchema.parse({
        status: "ok",
        records: [{ kind: "expert", id: "e1", name: "Ada", evidenceRefs: ["ev1"] }],
        evidence: [
          {
            claimType: "identity",
            claim: "NPI on file",
            sourceUrl: "https://npiregistry.cms.hhs.gov/provider-view/1234567890",
            sourceKind: "nppes",
            fetchedAt: "2026-10-24T00:00:00.000Z",
          },
        ],
      }).status,
    ).toBe("ok");
  });

  it("rejects an ok result whose evidence has no sourceUrl", () => {
    const parsed = researchResultSchema.safeParse({
      status: "ok",
      records: [],
      evidence: [
        {
          claimType: "identity",
          claim: "unsourced",
          sourceKind: "nppes",
          fetchedAt: "2026-10-24T00:00:00.000Z",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("parses a score breakdown item", () => {
    expect(
      scoreBreakdownItemSchema.parse({
        factor: "subtypeExpertise",
        points: 14,
        text: "14 papers on this disease since 2021",
        evidenceIds: ["ev1"],
      }).points,
    ).toBe(14);
  });
});
