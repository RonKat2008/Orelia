import { describe, expect, it } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { runResearch } from "@/lib/agents/orchestrator";
import { MemoryPersist } from "@/lib/agents/persist";
import type { SourcePorts } from "@/lib/agents/research/source-ports";
import type { ResearchAgent } from "@/lib/agents/research/types";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { agentNameSchema, type AgentName, type ResearchResult } from "@/lib/contracts";

const NOW = "2026-01-01T00:00:00.000Z";
const agent = (name: AgentName, run: ResearchAgent["run"]): ResearchAgent => ({ name, model: "claude-haiku-5-5", run });
const okResult = (npi: string, name: string): ResearchResult => ({
  status: "ok",
  records: [{ kind: "expert", id: name, name, npi, evidenceRefs: [`https://src/${npi}`] }],
  evidence: [{ claimType: "paper", claim: `${name} papers`, sourceUrl: `https://src/${npi}`, sourceKind: "pubmed", fetchedAt: NOW }],
});

async function setup(agents: ResearchAgent[]) {
  const cases = new MemoryCaseStore();
  const store = new MemoryRunStore();
  const persist = new MemoryPersist();
  const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
  const summary = await runResearch(c.id, {
    store, persist, cases, ports: {} as SourcePorts, agents,
  });
  const runs = await store.listByCase(c.id);
  return { c, cases, persist, summary, runs, status: (n: string) => runs.find((r) => r.agent === n)?.status };
}

describe("runResearch", () => {
  it("one agent throwing does not sink the others; statuses are recorded per agent", async () => {
    const { summary, runs, status, persist, c, cases } = await setup([
      agent("literature", async () => okResult("111", "Ada")),
      agent("trials", async () => {
        throw new Error("ctgov down");
      }),
      agent("identity", async () => ({ status: "error", message: "nppes 500" })),
      agent("centers", async () => okResult("222", "Bob")),
      agent("logistics", async () => ({ status: "not_implemented" })),
      // network/advocacy/aid/contact_finder missing from registry entirely
    ]);

    // One card per research agent, plus the needs/verifier/ranker/judge phase rows.
    expect(runs).toHaveLength(agentNameSchema.options.length + 4);
    expect(status("literature")).toBe("done");
    expect(status("centers")).toBe("done");
    expect(status("trials")).toBe("failed");
    expect(runs.find((r) => r.agent === "trials")?.error).toMatch(/ctgov down/);
    expect(status("identity")).toBe("failed");
    expect(status("logistics")).toBe("not_implemented");
    expect(status("network")).toBe("not_implemented");
    expect(runs.every((r) => ["done", "failed", "not_implemented"].includes(r.status))).toBe(true);

    expect(summary.candidates).toBe(0);
    expect(summary.verified.kept).toHaveLength(2);
    expect(summary.verified.kept.every((r) => r.shortlistEligibility?.eligible === false)).toBe(true);
    const list = await persist.getShortlist(c.id);
    expect(list).toHaveLength(0);
    expect(list.every((i) => i.evidence.length > 0 && i.breakdown.length === 4)).toBe(true);
    expect((await cases.get(c.id))?.status).toBe("ready");
  });

  it("creates all twelve runs as queued before any agent starts", async () => {
    const cases = new MemoryCaseStore();
    const store = new MemoryRunStore();
    const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
    let seenAtStart = 0;
    await runResearch(c.id, {
      store, persist: new MemoryPersist(), cases, ports: {} as SourcePorts,
      agents: [
        agent("literature", async () => {
          seenAtStart = (await store.listByCase(c.id)).length;
          return { status: "not_implemented" };
        }),
      ],
    });
    expect(seenAtStart).toBe(13); // twelve agents + the needs phase row, all created before any search starts
  });

  it("a hung agent is cut off by the timeout and marked failed", async () => {
    const cases = new MemoryCaseStore();
    const store = new MemoryRunStore();
    const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
    await runResearch(c.id, {
      store, persist: new MemoryPersist(), cases, ports: {} as SourcePorts,
      agentTimeoutMs: 20,
      agents: [agent("aid", () => new Promise(() => {}))],
    });
    const run = (await store.listByCase(c.id)).find((r) => r.agent === "aid");
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/timed out/);
  });
});
