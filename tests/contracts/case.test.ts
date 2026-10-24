import { describe, expect, it } from "vitest";
import { caseInputSchema, caseSchema } from "@/lib/contracts/case";

const input = {
  diseaseName: "Epithelioid sarcoma",
  diseaseCodes: { mesh: "D012509" },
  subtype: "proximal",
  homeCity: "Austin",
  homeState: "TX",
  goals: ["second_opinion", "trial"],
};

describe("Case contracts", () => {
  it("parses a valid case input and case", () => {
    expect(caseInputSchema.parse(input).diseaseName).toBe("Epithelioid sarcoma");
    expect(
      caseSchema.parse({
        ...input,
        id: "11111111-1111-4111-8111-111111111111",
        status: "unconfirmed",
        createdAt: "2026-10-24T00:00:00.000Z",
      }).status,
    ).toBe("unconfirmed");
  });

  it("rejects a case without a disease name", () => {
    expect(caseInputSchema.safeParse({ ...input, diseaseName: "" }).success).toBe(false);
  });
});
