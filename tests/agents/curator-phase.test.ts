import { describe, expect, it } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { MemoryCurationStore, type CurationStore } from "@/lib/agents/curator-store";
import { fallbackCuration, type ValidatedCuration } from "@/lib/agents/curator";
import { runResearch, type ResearchStep } from "@/lib/agents/orchestrator";
import { MemoryPersist, type RankedEntry } from "@/lib/agents/persist";
import type { SourcePorts } from "@/lib/agents/research/source-ports";
import type { ResearchAgent } from "@/lib/agents/research/types";
import { MemoryRunStore } from "@/lib/agents/run-store";
import type { AgentName, ResearchResult } from "@/lib/contracts";

const NOW = "2026-01-01T00:00:00.000Z";
const agent = (name: AgentName, run: ResearchAgent["run"]): ResearchAgent => ({ name, model: "claude-haiku-5-5", run });
const orgResult = (n: number): ResearchResult => ({
  status: "ok",
  records: [1, 2, 3].map((i) => ({
    kind: "organization" as const,
    id: `org-${n}-${i}`,
    name: `Org ${n}-${i}`,
    organizationKind: "advocacy" as const,
    url: `https://org${n}${i}.example`,
    evidenceRefs: [`https://src/org${n}${i}`],
  })),
  evidence: [1, 2, 3].map((i) => ({
    claimType: "advocacy",
    claim: `Org ${n}-${i}`,
    sourceUrl: `https://src/org${n}${i}`,
    sourceKind: "exa" as const,
    fetchedAt: NOW,
  })),
});

function bestOf(ranked: RankedEntry[]): ValidatedCuration {
  return {
    tiers: ranked.map((e, i) => ({
      candidateId: e.record.resource.id,
      kind: e.record.resource.kind,
      tier: i === 0 ? "best" : "good",
      reasons: [{ text: "why", evidenceIds: [] }],
    })),
    summary: "Top pick first.",
    suggested: ranked.slice(0, 1).map((e) => e.record.resource.id),
    dropped: [],
    source: "model",
  };
}

async function run(opts: { curate?: Parameters<typeof runResearch>[1]["curate"]; curations?: CurationStore; step?: ResearchStep } = {}) {
  const cases = new MemoryCaseStore();
  const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
  const persist = new MemoryPersist();
  const curations = opts.curations ?? new MemoryCurationStore();
  const summary = await runResearch(c.id, {
    store: new MemoryRunStore(), persist, cases, ports: {} as SourcePorts,
    agents: [agent("advocacy", async () => orgResult(1))],
    curate: opts.curate, curations, step: opts.step,
  });
  return { c, cases, persist, curations, summary };
}

describe("curate phase", () => {
  it("runs queue -> run-agents -> verify -> rank -> curate -> persist", async () => {
    const ids: string[] = [];
    const step: ResearchStep = { run: async (id, work) => (ids.push(id), work()) };
    await run({ step, curate: async (_c, _r, ranked) => bestOf(ranked) });
    expect(ids).toEqual(["queue", "run-agents", "verify", "contacts", "rank", "curate", "persist"]);
  });

  it("does not change ranking; saves curation; summary reports it", async () => {
    const withCuration = await run({ curate: async (_c, _r, ranked) => bestOf(ranked) });
    const without = await run({ curate: async (_c, _r, ranked) => fallbackCuration(ranked, "off") });
    expect(withCuration.summary.ranked.length).toBeGreaterThan(1);
    const strip = (s: typeof withCuration.summary) => s.ranked.map((e) => [e.record.resource.id, e.score, e.rank]);
    expect(strip(withCuration.summary)).toEqual(strip(without.summary));

    expect(withCuration.summary.curation).toMatchObject({ source: "model", best: 1 });
    const stored = await withCuration.curations.load(withCuration.c.id);
    expect(stored?.summary).toBe("Top pick first.");
    expect(stored?.suggested).toHaveLength(1);
    expect([...stored!.byTarget.values()].filter((v) => v.tier === "best")).toHaveLength(1);
  });

  it("curation step output is JSON-serializable", async () => {
    const outputs: unknown[] = [];
    const step: ResearchStep = { run: async (id, work) => { const v = await work(); if (id === "curate") outputs.push(v); return v; } };
    await run({ step, curate: async (_c, _r, ranked) => bestOf(ranked) });
    expect(JSON.parse(JSON.stringify(outputs[0]))).toEqual(outputs[0]);
  });

  it("a throwing curations.save does not fail the case", async () => {
    const broken: CurationStore = { save: async () => { throw new Error("db down"); }, load: async () => null };
    const { summary, cases, c } = await run({ curations: broken, curate: async (_c, _r, ranked) => bestOf(ranked) });
    expect(summary.candidates).toBeGreaterThan(0);
    expect((await cases.get(c.id))?.status).toBe("ready");
  });

  it("fallback curation is stored as all backup with no suggestions", async () => {
    const { summary, curations, c } = await run({ curate: async (_c, _r, ranked) => fallbackCuration(ranked, "model down") });
    expect(summary.curation).toEqual({ source: "fallback", best: 0, suggested: [] });
    const stored = await curations.load(c.id);
    expect([...stored!.byTarget.values()].every((v) => v.tier === "backup")).toBe(true);
    expect(stored!.suggested).toEqual([]);
  });
});
