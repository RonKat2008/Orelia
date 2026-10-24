import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { MemoryCurationStore } from "@/lib/agents/curator-store";
import { extractCase } from "@/lib/agents/intake-extractor";
import { MemoryNeedsStore, setNeedsStoreForTests } from "@/lib/agents/needs";
import { runResearch } from "@/lib/agents/orchestrator";
import { makeDefaultJudge } from "@/lib/agents/needs-judge-phase";
import { MemoryPersist } from "@/lib/agents/persist";
import { researchAgents } from "@/lib/agents/research";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";

describe("needs + judge through the full offline pipeline", () => {
  const needsStore = new MemoryNeedsStore();
  beforeEach(() => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    setNeedsStoreForTests(needsStore);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setNeedsStoreForTests(undefined);
  });

  for (const slug of ["vascular-eds", "epithelioid-sarcoma", "igg4-related-disease"]) {
    it(`${slug}: needs phase, judge phase, verdicts cite only the candidate's own evidence`, async () => {
      const input = await extractCase(readFileSync(`fixtures/reports/${slug}.md`, "utf8"));
      const cases = new MemoryCaseStore();
      const c = await cases.create(input, "confirmed");
      const store = new MemoryRunStore();
      const summary = await runResearch(c.id, { store, persist: new MemoryPersist(), cases, ports: createFixturePorts(), agents: researchAgents, curations: new MemoryCurationStore() });
      const runs = await store.listByCase(c.id);
      expect(runs.find((r) => r.agent === "needs")?.status).toBe("done");
      expect(runs.find((r) => r.agent === "judge")?.status).toBe("done");
      expect(summary.curation.source).toBe("model");
      expect(summary.needs?.items).toBeGreaterThan(0);
      expect(summary.timings.needsWaitMs).toBeLessThanOrEqual(10_500);

      const needs = await needsStore.loadNeeds(c.id);
      const result = await needsStore.loadJudge(c.id);
      expect(needs?.caseId).toBe(c.id);
      expect(result?.judgements).toHaveLength(summary.ranked.length);
      const own = new Map(summary.ranked.map((e) => [e.record.resource.id, new Set(e.record.evidence.map((x) => x.id))]));
      for (const v of result!.judgements) {
        for (const id of v.evidenceIds) expect(own.get(v.candidateId)?.has(id)).toBe(true);
        if (v.verdict !== "drop") expect(v.evidenceIds.length).toBeGreaterThan(0);
        expect(v.reason.length).toBeGreaterThan(0);
        expect(flagMedicalAdvice(v.reason).flagged).toBe(false);
        expect(flagMedicalAdvice(v.plain).flagged).toBe(false);
      }
      expect(result!.judgements.map((v) => v.order)).toEqual(result!.judgements.map((_, i) => i + 1));
      // Scores are never changed by the judge.
      for (const v of result!.judgements) expect(v.score).toBe(summary.ranked.find((e) => e.record.resource.id === v.candidateId)?.score);
    });
  }
});

describe("a slow needs analyst never holds the pipeline for long", () => {
  beforeEach(() => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("settles late, keeps the analyst alive, and the judge picks the saved profile up", async () => {
    const input = await extractCase(readFileSync("fixtures/reports/vascular-eds.md", "utf8"));
    const cases = new MemoryCaseStore();
    const c = await cases.create(input, "confirmed");
    const late = new MemoryNeedsStore();
    const profile = { caseId: c.id, fromCache: false, specialties: [], centerCapabilities: [], redFlags: [], trialEligibility: [], supportNeeds: [], questions: [], sources: [] } as unknown as import("@/lib/contracts").CareNeeds;
    let saved = false;
    let finish = () => {};
    const kept: Promise<unknown>[] = [];
    const seen: unknown[] = [];
    const t0 = Date.now();
    const summary = await runResearch(c.id, {
      store: new MemoryRunStore(), persist: new MemoryPersist(), cases, ports: createFixturePorts(), agents: researchAgents, curations: new MemoryCurationStore(),
      needs: () => new Promise((resolve) => { finish = () => { saved = true; resolve(profile); }; }),
      needsWaitMs: 0, needsExtraWaitMs: 20, lateNeedsPickupMs: 2_000,
      // The analyst only finishes after the fan-out has given up on it.
      keepAlive: (w) => { kept.push(w); setTimeout(() => finish(), 30); },
      loadNeeds: async () => (saved ? profile : null),
      judge: async (id, cr, ranked, needs, store) => { seen.push(needs); return makeDefaultJudge(() => late)(id, cr, ranked, undefined, store); },
    });
    expect(kept).toHaveLength(1);
    expect(seen[0]).toBe(profile);
    expect(summary.curation).toBeDefined();
    expect((await late.loadJudge(c.id))?.judgements.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
