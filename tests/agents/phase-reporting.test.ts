import { describe, expect, it } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { runResearch } from "@/lib/agents/orchestrator";
import { MemoryPersist } from "@/lib/agents/persist";
import { MemoryRunStore } from "@/lib/agents/run-store";
import type { SourcePorts } from "@/lib/agents/research/source-ports";
import type { ResearchAgent } from "@/lib/agents/research/types";
import { ensureRun } from "@/lib/agents/phase-runs";

const NOW = "2026-01-01T00:00:00.000Z";
const literature: ResearchAgent = {
  name: "literature", model: "claude-haiku-5-5",
  run: async () => ({
    status: "ok",
    records: [{ kind: "expert", id: "e", name: "Dr A", npi: "1", evidenceRefs: ["https://src/1"] }],
    evidence: [{ claimType: "paper", claim: "papers", sourceUrl: "https://src/1", sourceKind: "pubmed", fetchedAt: NOW }],
  }),
};

describe("post-search phase reporting", () => {
  it("records needs, verifier, ranker and judge rows in order, each finished, one row per phase", async () => {
    const cases = new MemoryCaseStore();
    const store = new MemoryRunStore();
    const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
    const seen: string[] = [];
    const wrapped = { ...store, create: store.create.bind(store), update: async (id: string, p: Parameters<MemoryRunStore["update"]>[1]) => {
      const run = (await store.listByCase(c.id)).find((r) => r.id === id);
      if (run && ["verifier", "ranker", "judge"].includes(run.agent) && p.status === "running") seen.push(run.agent);
      return store.update(id, p);
    }, listByCase: store.listByCase.bind(store), deleteByCase: store.deleteByCase.bind(store) };
    await runResearch(c.id, { store: wrapped, persist: new MemoryPersist(), cases, ports: {} as SourcePorts, agents: [literature] });
    const runs = await store.listByCase(c.id);
    for (const agent of ["verifier", "ranker", "judge"]) {
      const rows = runs.filter((r) => r.agent === agent);
      expect(rows, agent).toHaveLength(1);
      expect(rows[0]!.status, agent).toBe("done");
      expect(rows[0]!.finishedAt, agent).toBeInstanceOf(Date);
    }
    expect(seen).toEqual(["verifier", "ranker", "judge"]);
    expect(runs.every((r) => ["done", "failed", "not_implemented"].includes(r.status))).toBe(true);
    expect((await cases.get(c.id))?.status).toBe("ready");
  });

  it("ensureRun never creates a second row for the same agent", async () => {
    const store = new MemoryRunStore();
    const a = await ensureRun(store, "c", "verifier");
    expect(await ensureRun(store, "c", "verifier")).toBe(a);
    expect(await store.listByCase("c")).toHaveLength(1);
  });

  it("a failed attempt leaves no open rows", async () => {
    const cases = new MemoryCaseStore();
    const store = new MemoryRunStore();
    const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
    await expect(runResearch(c.id, {
      store, persist: { saveResults: async () => { throw new Error("db down"); } } as unknown as MemoryPersist,
      cases, ports: {} as SourcePorts, agents: [literature],
    })).rejects.toThrow("db down");
    expect((await cases.get(c.id))?.status).toBe("research_failed");
    expect((await store.listByCase(c.id)).every((r) => ["done", "failed", "not_implemented"].includes(r.status))).toBe(true);
  });
});

describe("all sources failing", () => {
  const failing: ResearchAgent = { name: "literature", model: "claude-haiku-5-5", run: async () => ({ status: "error", message: "502" }) };
  it("ends research_failed with no open rows instead of an empty ready shortlist", async () => {
    const cases = new MemoryCaseStore();
    const store = new MemoryRunStore();
    const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
    await expect(runResearch(c.id, { store, persist: new MemoryPersist(), cases, ports: {} as SourcePorts, agents: [failing, { ...failing, name: "trials" }] })).rejects.toThrow(/Every research source failed/);
    expect((await cases.get(c.id))?.status).toBe("research_failed");
    expect((await store.listByCase(c.id)).every((r) => ["done", "failed", "not_implemented"].includes(r.status))).toBe(true);
  });
});
