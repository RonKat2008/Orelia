import { describe, expect, it } from "vitest";
import type { CareNeeds } from "@/lib/contracts/care-needs";
import type { Judgement, JudgeResult } from "@/lib/contracts/judge";
import {
  confidenceLabel,
  formatScore,
  groupVerdicts,
  lookupSources,
  needLabels,
  resolveNeeds,
  verdictLabel,
} from "@/components/judge/view-model";

const j = (candidateId: string, verdict: Judgement["verdict"], order: number): Judgement =>
  ({ candidateId, verdict, order }) as Judgement;

const needs = {
  specialties: [{ id: "s1", specialty: "Vascular genetics", subspecialty: "EDS" }],
  centerCapabilities: [{ id: "c1", text: "Has a connective-tissue clinic" }],
  redFlags: [],
  trialEligibility: [],
  supportNeeds: [],
  sources: [{ id: "a", title: "GeneReviews", url: "https://example.org/a" }],
} as unknown as CareNeeds;

describe("judge view-model", () => {
  it("groups verdicts in keep/maybe/drop order sorted by order, omitting empty sections", () => {
    const judge = {
      judgements: [j("d", "drop", 4), j("k2", "keep", 2), j("k1", "keep", 1)],
    } as JudgeResult;
    const sections = groupVerdicts(judge);
    expect(sections.map((s) => s.verdict)).toEqual(["keep", "drop"]);
    expect(sections[0].items.map((i) => i.candidateId)).toEqual(["k1", "k2"]);
  });

  it("resolves need ids to labels and skips unknown ids", () => {
    const labels = needLabels(needs);
    expect(resolveNeeds(["s1", "nope", "c1"], labels)).toEqual([
      "Vascular genetics (EDS)",
      "Has a connective-tissue clinic",
    ]);
    expect(needLabels(null).size).toBe(0);
  });

  it("formats score and labels", () => {
    expect(formatScore(65.6)).toBe("score 66 / 100");
    expect(verdictLabel("drop")).toBe("Dropped");
    expect(confidenceLabel("low")).toBe("Low confidence");
  });

  it("looks up sources, skipping unknown and duplicate ids", () => {
    expect(lookupSources(["a", "a", "zzz"], needs)).toEqual([
      { id: "a", title: "GeneReviews", url: "https://example.org/a" },
    ]);
  });
});
