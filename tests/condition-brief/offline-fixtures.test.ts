import { describe, expect, it } from "vitest";
import { buildConditionBrief } from "@/lib/condition-brief/build";
import { MemoryConditionBriefStore } from "@/lib/condition-brief/store";

const CASE = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-24T12:00:00.000Z");
const CASES = [
  "Epithelioid sarcoma",
  "Vascular Ehlers-Danlos syndrome",
  "IgG4-related disease",
] as const;

describe("offline condition brief fixtures (real collectors + recorded LLM output)", () => {
  it.each(CASES)("%s builds a fully sourced, tagged brief", async diseaseName => {
    const brief = await buildConditionBrief(CASE, diseaseName, {
      offline: true,
      now: () => NOW,
      store: new MemoryConditionBriefStore(),
    });
    expect(brief.mode).toBe("offline");
    expect(brief.statements.length).toBeGreaterThanOrEqual(5);
    expect(brief.questions.length).toBeGreaterThanOrEqual(1);
    const byId = new Map(brief.sources.map(s => [s.id, s]));
    for (const st of brief.statements) {
      expect(["established", "emerging", "uncertain"]).toContain(st.evidenceLevel);
      expect(st.sourceIds.length).toBeGreaterThan(0);
      for (const id of st.sourceIds) expect(byId.get(id)?.url).toMatch(/^https?:\/\//);
    }
    // the recorded fixture must survive the validator intact (no generator statements dropped)
    expect(brief.dropped.filter(d => /^s\d+$/.test(d.id))).toEqual([]);
  });
});
