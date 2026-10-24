import { describe, expect, it } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { runResearch } from "@/lib/agents/orchestrator";
import { MemoryPersist } from "@/lib/agents/persist";
import { researchAgents } from "@/lib/agents/research";
import { createLivePorts } from "@/lib/agents/research/live-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { SourceError, type Transport } from "@/lib/sources";

const MODES: Record<string, Transport> = {
  http500: { request: async () => { throw new SourceError("http", "HTTP 500 https://x/y", 500); } },
  garbage: { request: async () => ({ body: "<html>not json or xml</html>", fetchedAt: new Date().toISOString(), status: 200 }) },
  emptyJson: { request: async () => ({ body: "{}", fetchedAt: new Date().toISOString(), status: 200 }) },
  hang: { request: () => new Promise(() => {}) },
};

describe("upstream outage chaos (live ports, real agents)", () => {
  for (const [mode, transport] of Object.entries(MODES)) {
    it(`${mode}: every run reaches a terminal state and the case never stays researching`, async () => {
      const cases = new MemoryCaseStore();
      const store = new MemoryRunStore();
      const c = await cases.create({ diseaseName: "Epithelioid sarcoma", goals: [], homeState: "AZ" } as never, "confirmed");
      const ports = createLivePorts({ transport, env: { NCBI_API_KEY: undefined, EXA_API_KEY: undefined } });
      let threw: unknown;
      try {
        await runResearch(c.id, { store, persist: new MemoryPersist(), cases, ports, agents: researchAgents, agentTimeoutMs: 1500 });
      } catch (e) { threw = e; }
      const runs = await store.listByCase(c.id);
      const status = (await cases.get(c.id))?.status;
      console.log(mode, "threw:", threw instanceof Error ? threw.message.slice(0, 120) : threw, "case:", status, "runs:", runs.map((r) => `${r.agent}=${r.status}`).join(" "));
      expect(["ready", "research_failed"]).toContain(status);
      expect(runs.every((r) => ["done", "failed", "not_implemented"].includes(r.status))).toBe(true);
    }, 30_000);
  }
});
