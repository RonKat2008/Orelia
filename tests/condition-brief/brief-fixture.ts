import type { ConditionBrief } from "@/lib/condition-brief/contract";
import { src } from "./core-fixture";

export function makeBrief(caseId: string, overrides: Partial<ConditionBrief> = {}): ConditionBrief {
  return {
    caseId,
    diseaseName: "Vascular Ehlers-Danlos syndrome",
    version: 1,
    generatedAt: "2026-02-01T00:00:00.000Z",
    mode: "offline",
    sources: [src("orphanet:1", "orphanet", "reference_page")],
    prevalence: [{ label: "<1 / 1 000 000", sourceId: "orphanet:1" }],
    statements: [{ id: "s1", section: "rarity", text: "The condition is rare.", evidenceLevel: "established", sourceIds: ["orphanet:1"] }],
    studies: [],
    research: [],
    registries: [],
    questions: [{ id: "q1", text: "How rare is this condition?", statementIds: ["s1"] }],
    dropped: [],
    ...overrides,
  };
}
