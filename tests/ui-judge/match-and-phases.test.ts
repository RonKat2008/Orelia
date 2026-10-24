import { describe, expect, it } from "vitest";
import { plainSentenceFor, verdictFor } from "@/components/judge/match";
import { activePhaseTimer, derivePhase, needsLine, parseRunsSnapshot, PHASES, AGENT_NAMES } from "@/components/swarm/stream";
import type { JudgeResult } from "@/lib/contracts/judge";

const base = () => ({ tier: "good" as const, reason: "r", evidenceIds: ["e"], links: [], needsMet: [], needsMissed: [], confidence: "high" as const, flags: [], score: 1, rank: 1, overrides: [], source: "model" as const });
const judge: JudgeResult = {
  caseId: "c", generatedAt: "2026-01-01T00:00:00.000Z", source: "model", model: "m", summary: "", counts: { keep: 1, maybe: 0, drop: 1 }, rejected: [], elapsedMs: 1,
  judgements: [
    { ...base(), candidateId: "x1", kind: "trial", name: "A Study", nctId: "NCT00000001", verdict: "keep", plain: "This study is for adults with your condition.", order: 1 },
    { ...base(), candidateId: "x2", kind: "institution", name: "Some Clinic", verdict: "drop", plain: "Set aside.", order: 2 },
  ],
};

describe("patient view plain sentence", () => {
  it("matches trials by NCT id even when the persisted id differs", () => {
    expect(plainSentenceFor(judge, { kind: "trial", title: "Different title", nctId: "NCT00000001" })).toMatch(/adults/);
  });
  it("matches by kind + normalized name and never shows a dropped verdict as a pick sentence", () => {
    expect(verdictFor(judge, { kind: "institution", name: "some  clinic" })?.candidateId).toBe("x2");
    expect(plainSentenceFor(judge, { kind: "institution", name: "Some Clinic" })).toBeUndefined();
    expect(plainSentenceFor(null, { kind: "trial", nctId: "NCT00000001" })).toBeUndefined();
  });
});

describe("swarm phases: understanding your condition + final judge", () => {
  const T = "2026-01-01T00:00:00.000Z";
  const snap = (rows: unknown[]) => parseRunsSnapshot(JSON.stringify({ caseStatus: "researching", runs: [...AGENT_NAMES.map((agent) => ({ agent, status: "done" })), ...rows] }))!;
  it("labels the last stepper phase Final judge", () => {
    expect(PHASES.map((p) => p.label)).toEqual(["Search", "Verify", "Rank", "Final judge"]);
  });
  it("reports the needs row with its summary and a judge row as the final phase", () => {
    const s = snap([{ agent: "needs", status: "done", startedAt: T, finishedAt: T, outputSummary: "4 specialties, 10 sources in 20.0s" }, { agent: "verifier", status: "done" }, { agent: "ranker", status: "done" }, { agent: "judge", status: "running" }]);
    expect(needsLine(s.phases)).toMatchObject({ state: "done", label: "Understanding your condition", detail: "4 specialties, 10 sources in 20.0s" });
    expect(s.phases.judge?.status).toBe("running");
    expect(derivePhase(s.cards, "researching", s.phases)).toBe(3);
  });
  it("a judge row wins over a legacy curator row", () => {
    const s = snap([{ agent: "judge", status: "running" }, { agent: "curator", status: "done" }]);
    expect(s.phases.judge?.status).toBe("running");
  });
  it("streams the judge's running progress into the phase timer", () => {
    const s = snap([{ agent: "verifier", status: "done" }, { agent: "ranker", status: "done", finishedAt: T }, { agent: "judge", status: "running", startedAt: T, outputSummary: "Judged 4 of 13 (2 kept so far)" }]);
    expect(activePhaseTimer(s.cards, "researching", s.phases)).toMatchObject({ phase: "judge", detail: "Judged 4 of 13 (2 kept so far)" });
  });
  it("needs unavailable is shown as skipped, not as an error", () => {
    expect(needsLine(snap([{ agent: "needs", status: "not_implemented" }]).phases).state).toBe("unavailable");
    expect(needsLine({}).state).toBe("waiting");
  });
});
