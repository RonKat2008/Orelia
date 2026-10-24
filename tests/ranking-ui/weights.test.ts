import { describe, expect, it } from "vitest";
import { RANKING_WEIGHTS } from "@/config/ranking";
import {
  RANKING_FACTORS,
  RANKING_FORMULA,
  agreementByKind,
  parseWeights,
  previewRank,
  signalsFromBreakdown,
} from "@/components/ranking/model";

const evidence = ["ev-1"];

describe("ranking weights panel model", () => {
  it("keeps the four factors in priority order and states the formula", () => {
    expect(RANKING_FACTORS).toEqual([
      "subtypeExpertise",
      "institutionalFit",
      "access",
      "contactability",
    ]);
    expect(RANKING_FORMULA).toContain("subtype expertise");
    expect(RANKING_FORMULA.indexOf("subtype")).toBeLessThan(RANKING_FORMULA.indexOf("institutional"));
    expect(RANKING_FORMULA.indexOf("institutional")).toBeLessThan(RANKING_FORMULA.indexOf("access"));
    expect(RANKING_FORMULA.indexOf("access")).toBeLessThan(RANKING_FORMULA.indexOf("contactability"));
  });

  it("rejects a missing or negative weight", () => {
    expect(parseWeights(null).ok).toBe(false);
    expect(parseWeights({ ...RANKING_WEIGHTS, access: -1 }).ok).toBe(false);
    expect(parseWeights({ ...RANKING_WEIGHTS }).ok).toBe(true);
  });

  it("rebuilds 0–1 signals from a default-weight breakdown and ignores unsupported factors", () => {
    const signals = signalsFromBreakdown([
      {
        factor: "subtypeExpertise",
        points: 25,
        text: "14 papers on this disease since 2021",
        evidenceIds: evidence,
      },
      {
        factor: "access",
        points: 0,
        text: "No verified evidence available",
        evidenceIds: [],
      },
    ]);
    expect(signals.subtypeExpertise?.value).toBe(0.5);
    expect(signals.access).toBeUndefined();
  });

  it("re-ranks stored candidates without changing their stored points", () => {
    const stored = [
      {
        id: "b",
        targetKind: "expert",
        targetId: "11111111-1111-4111-8111-111111111111",
        scoreBreakdown: [
          { factor: "subtypeExpertise", points: 50, text: "Many matching papers", evidenceIds: evidence },
          { factor: "institutionalFit", points: 0, text: "No verified evidence available", evidenceIds: [] },
          { factor: "access", points: 0, text: "No verified evidence available", evidenceIds: [] },
          { factor: "contactability", points: 0, text: "No verified evidence available", evidenceIds: [] },
        ],
      },
      {
        id: "a",
        targetKind: "trial",
        targetId: "22222222-2222-4222-8222-222222222222",
        scoreBreakdown: [
          { factor: "subtypeExpertise", points: 10, text: "A few matching papers", evidenceIds: evidence },
          { factor: "institutionalFit", points: 25, text: "NCI designated center", evidenceIds: evidence },
          { factor: "access", points: 15, text: "Recruiting in the home state", evidenceIds: evidence },
          { factor: "contactability", points: 10, text: "Public site contact", evidenceIds: evidence },
        ],
      },
    ];
    const before = structuredClone(stored);
    const ranked = previewRank(stored, { ...RANKING_WEIGHTS });
    expect(stored).toEqual(before);
    expect(ranked.map((row) => row.id)).toEqual(["a", "b"]);
    const flipped = previewRank(stored, {
      subtypeExpertise: 100,
      institutionalFit: 0,
      access: 0,
      contactability: 0,
    });
    expect(flipped.map((row) => row.id)).toEqual(["b", "a"]);
    expect(flipped[0]?.score).toBe(100);
  });

  it("summarizes agreement rate per resource kind", () => {
    const summary = agreementByKind([
      { targetKind: "expert", verdict: "correct" },
      { targetKind: "expert", verdict: "incorrect" },
      { targetKind: "expert", verdict: "correct" },
      { targetKind: "trial", verdict: "incorrect" },
    ]);
    expect(summary).toEqual([
      { targetKind: "expert", correct: 2, incorrect: 1, total: 3, agreementRate: 2 / 3 },
      { targetKind: "trial", correct: 0, incorrect: 1, total: 1, agreementRate: 0 },
    ]);
  });
});
