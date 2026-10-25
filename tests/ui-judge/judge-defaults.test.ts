import { describe, expect, it } from "vitest";
import { minimumNecessaryFields } from "@/components/outreach/fields";
import { topPicks, type ShortlistCard } from "@/components/shortlist/data";

const card = (id: string, score: number, tier?: string) =>
  ({ resource: { id, kind: "provider" }, score, tier, evidence: [], caseCandidateId: id }) as unknown as ShortlistCard;

describe("minimumNecessaryFields", () => {
  it("shares diagnosis, state and goals with care sites", () => {
    expect(minimumNecessaryFields("institution")).toEqual(["diseaseName", "homeState", "goals"]);
  });
  it("shares only diagnosis and goals with organizations", () => {
    expect(minimumNecessaryFields("organization")).toEqual(["diseaseName", "goals"]);
  });
  it("never pre-fills insurance, plan id, stage or subtype", () => {
    const all = [...minimumNecessaryFields("institution"), ...minimumNecessaryFields("organization")];
    for (const key of ["insurer", "planId", "stageSummary", "subtype", "homeCity"]) expect(all).not.toContain(key);
  });
});

describe("topPicks", () => {
  it("puts curator suggestions first, then best scores, never excluded, capped at the limit", () => {
    const items = [card("a", 10), card("b", 90), card("c", 50), card("x", 99, "exclude"), card("d", 70)];
    expect(topPicks(items, ["c"], 3)).toEqual(["c", "b", "d"]);
  });
  it("ignores suggestions that are not on the list and de-duplicates", () => {
    const items = [card("a", 10), card("b", 20)];
    expect(topPicks(items, ["zzz", "b", "b"], 5)).toEqual(["b", "a"]);
  });
});
