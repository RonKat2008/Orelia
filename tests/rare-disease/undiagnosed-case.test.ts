import { describe, expect, it } from "vitest";
import { caseInputSchema, normalizeUndiagnosed, UNDIAGNOSED_DISEASE_NAME } from "@/lib/contracts";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { undiagnosedCaseInput, undiagnosedFieldsSchema } from "@/app/api/cases/_lib/undiagnosed";

describe("undiagnosed case flag", () => {
  it("replaces any condition name, codes and subtype with the fixed label", () => {
    const out = normalizeUndiagnosed({ diseaseName: "Lupus", diseaseCodes: { orpha: "536" }, subtype: "x", undiagnosed: true, goals: [] });
    expect(out).toEqual({ diseaseName: UNDIAGNOSED_DISEASE_NAME, undiagnosed: true, goals: [] });
  });

  it("leaves diagnosed cases untouched", () => {
    const input = { diseaseName: "Vascular Ehlers-Danlos syndrome", subtype: "COL3A1", goals: [] };
    expect(normalizeUndiagnosed(input)).toBe(input);
  });

  it("builds the case from question-flow answers in code, with the patient's own words", () => {
    const c = undiagnosedCaseInput({ homeCity: "Pittsburgh", homeState: "PA", travelLimitMiles: 300, goals: ["support"], symptomNotes: "My joints hurt." });
    expect(c).toMatchObject({ diseaseName: UNDIAGNOSED_DISEASE_NAME, undiagnosed: true, homeState: "PA", symptomNotes: "My joints hurt." });
    expect(caseInputSchema.safeParse(c).success).toBe(true);
  });

  it("rejects a condition name smuggled into the undiagnosed fields", () => {
    expect(undiagnosedFieldsSchema.safeParse({ diseaseName: "Lupus" }).success).toBe(false);
  });

  it("the store keeps the flag and never stores a guessed name", async () => {
    const store = new MemoryCaseStore();
    const created = await store.create({ diseaseName: "Guess", undiagnosed: true, goals: [] });
    expect(created.diseaseName).toBe(UNDIAGNOSED_DISEASE_NAME);
    const updated = await store.update(created.id, { diseaseName: "Another guess", undiagnosed: true, goals: [] }, "confirmed");
    expect(updated?.diseaseName).toBe(UNDIAGNOSED_DISEASE_NAME);
    expect(updated?.undiagnosed).toBe(true);
  });
});
