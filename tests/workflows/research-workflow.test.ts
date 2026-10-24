import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCaseStore, DbCaseStore } from "@/lib/agents/case-store";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { researchAgents } from "@/lib/agents/research";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { MemoryPersist } from "@/lib/agents/persist";
import type { OrchestratorDeps, ResearchStep } from "@/lib/agents/orchestrator";
import type { SourcePorts } from "@/lib/agents/research/source-ports";
import { createResearchWorkflow, executeResearch, failResearch, RESEARCH_TIMEOUT_MS } from "@/lib/workflows/research-workflow";
import { inngest } from "@/lib/workflows/inngest";
import { MemoryOwnerStore } from "@/lib/auth/ownership";
import { signSession } from "@/lib/auth/session";
import { resetMemoryRateLimitStore } from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({ services: vi.fn(), wiring: vi.fn(), after: vi.fn() }));
vi.mock("@/app/api/cases/_lib/services", () => ({ getServices: mocks.services }));
vi.mock("@/app/api/cases/_lib/research-wiring", () => ({ getResearchWiring: mocks.wiring }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
import { POST } from "@/app/api/cases/[id]/research/route";

/** Round-trip through JSON, just like durable step outputs across fresh invocations. */
class MemoStep implements ResearchStep {
  readonly saved = new Map<string, string>();
  readonly calls: string[] = [];
  async run<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (!this.saved.has(id)) {
      this.calls.push(id);
      this.saved.set(id, JSON.stringify(await work()));
    }
    return JSON.parse(this.saved.get(id)!) as T;
  }
}

const SESSION = "test-session";
const SECRET = "test-secret";
const owners = new MemoryOwnerStore();
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };

async function setup() {
  const cases = new MemoryCaseStore();
  const c = await cases.create({ diseaseName: "X", goals: [] }, "confirmed");
  const run = vi.fn(async () => ({ status: "not_implemented" as const }));
  const deps: OrchestratorDeps = {
    cases, store: new MemoryRunStore(), persist: new MemoryPersist(), ports: {} as SourcePorts,
    agents: [{ name: "literature", model: "claude-haiku-5-5", run }],
  };
  owners.registerCase(c.id, SESSION);
  mocks.services.mockReturnValue({ cases, runs: deps.store, persist: deps.persist });
  mocks.wiring.mockResolvedValue({ ports: deps.ports, agents: deps.agents });
  return { deps, c, run, step: new MemoStep() };
}
const post = (id: string) => POST(
  new Request("http://localhost", {
    method: "POST",
    headers: { origin: "http://localhost", cookie: `wf_session=${signSession(SESSION, { WAYFINDER_SESSION_SECRET: SECRET })}` },
  }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  vi.stubEnv("WAYFINDER_SESSION_SECRET", SECRET);
  vi.stubEnv("DATABASE_URL", "");
  holder.__wayfinderOwnerStore = owners;
  resetMemoryRateLimitStore();
  vi.stubEnv("WAYFINDER_OFFLINE", "0");
  vi.stubEnv("INNGEST_EVENT_KEY", "test-event-key");
  vi.stubEnv("INNGEST_SIGNING_KEY", "test-signing-key");
  mocks.after.mockReset();
  mocks.wiring.mockReset();
});
afterEach(() => { delete holder.__wayfinderOwnerStore; resetMemoryRateLimitStore(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("research durability", () => {
  it("memoizes every phase through a persistence retry; successful agents are not rerun", async () => {
    const { deps, c, run, step } = await setup();
    const save = vi.spyOn(deps.persist, "saveResults").mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(executeResearch(c.id, deps, step)).rejects.toThrow("DB unavailable");
    expect((await deps.cases.get(c.id))?.status).toBe("researching");
    await executeResearch(c.id, deps, step);
    expect(run).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    // Nine agents + verifier/ranker/curator phase rows; the persistence retry added none.
    expect(await deps.store.listByCase(c.id)).toHaveLength(12);
    expect(step.calls).toEqual(["deadline", "queue", "run-agents", "verify", "contacts", "rank", "curate", "persist", "persist"]);
    expect((await deps.cases.get(c.id))?.status).toBe("ready");
    // Full replay performs no writes and doesn't regress ready -> researching.
    await executeResearch(c.id, deps, step);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("preserves evidenced fixture resources across serialized checkpoints", async () => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    const { deps, step } = await setup();
    const c = await deps.cases.create({ diseaseName: "Epithelioid sarcoma", homeState: "AZ", goals: ["second_opinion", "trial"] }, "confirmed");
    deps.ports = createFixturePorts();
    deps.agents = researchAgents;
    const summary = await executeResearch(c.id, deps, step);
    const shortlist = await deps.persist.getShortlist(c.id);
    expect(summary.candidates).toBeGreaterThan(0);
    expect(shortlist).toHaveLength(summary.candidates);
    for (const item of shortlist) {
      expect(item.evidence.length).toBeGreaterThan(0);
      for (const evidence of item.evidence) expect(evidence.sourceUrl).toMatch(/^https?:/);
      for (const factor of item.breakdown) {
        for (const id of factor.evidenceIds) expect(item.evidence.some((e) => e.id === id)).toBe(true);
      }
    }
  });

  it("retries verification without rerunning the agents", async () => {
    const { deps, c, run, step } = await setup();
    deps.proposer = vi.fn().mockRejectedValueOnce(new Error("verifier down")).mockResolvedValue({ merges: [], conflicts: [] });
    await expect(executeResearch(c.id, deps, step)).rejects.toThrow("verifier down");
    await executeResearch(c.id, deps, step);
    expect(run).toHaveBeenCalledTimes(1);
    expect(deps.proposer).toHaveBeenCalledTimes(2);
  });

  it("isolates agent failures and still publishes a ready shortlist", async () => {
    const { deps, c, step } = await setup();
    deps.agents = [...deps.agents, { name: "trials", model: "claude-haiku-5-5", run: async () => { throw new Error("source unavailable"); } }];
    const summary = await executeResearch(c.id, deps, step);
    expect(summary.runStatuses.trials).toBe("failed");
    expect(summary.runStatuses.literature).toBe("not_implemented");
    expect((await deps.cases.get(c.id))?.status).toBe("ready");
  });

  it("retrying from research_failed clears the old attempt's rows and starts one heartbeat, without duplicates", async () => {
    const { deps, c } = await setup();
    mocks.after.mockImplementation(() => undefined);
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    await deps.cases.setStatus(c.id, "research_failed");
    const stale = await deps.store.create(c.id, "literature");
    await deps.store.update(stale, { status: "running", startedAt: new Date(0) });
    expect((await post(c.id)).status).toBe(202);
    const rows = await deps.store.listByCase(c.id);
    expect(rows.map((r) => r.agent)).toEqual(["research"]);
    expect(rows[0]!.id).not.toBe(stale);
    // A double click while running is rejected and adds nothing.
    expect((await post(c.id)).status).toBe(409);
    expect(await deps.store.listByCase(c.id)).toHaveLength(1);
  });

  it("a stale 'researching' case (function died) is reclaimed and restartable; a fresh one still gets 409", async () => {
    const { deps, c } = await setup();
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    mocks.after.mockImplementation(() => undefined);
    await deps.cases.setStatus(c.id, "researching");
    const old = await deps.store.create(c.id, "literature");
    await deps.store.update(old, { status: "running", startedAt: new Date(Date.now() - 10 * 60_000) });
    expect((await post(c.id)).status).toBe(202);
    expect((await deps.store.listByCase(c.id)).map((r) => r.agent)).toEqual(["research"]);
    expect((await post(c.id)).status).toBe(409);
  });

  it("failResearch also fails open runs so no card keeps spinning", async () => {
    const { deps, c } = await setup();
    await deps.cases.setStatus(c.id, "researching");
    const id = await deps.store.create(c.id, "trials");
    await deps.store.update(id, { status: "running" });
    await failResearch(c.id, { cases: deps.cases, runs: deps.store });
    expect((await deps.cases.get(c.id))?.status).toBe("research_failed");
    expect((await deps.store.listByCase(c.id))[0]!.status).toBe("failed");
  });

  it("registers terminal failure cleanup and a per-case singleton", async () => {
    const { deps, c, step } = await setup();
    await deps.cases.setStatus(c.id, "researching");
    const fn = createResearchWorkflow(async () => deps);
    expect(fn.opts.singleton).toEqual({ key: "event.data.caseId", mode: "skip" });
    expect(fn.opts.triggers).toEqual([{ event: "case/research.requested" }]);
    const onFailure = fn.opts.onFailure as unknown as (ctx: unknown) => Promise<void>;
    await onFailure({ event: { data: { event: { data: { caseId: c.id } } } }, step });
    expect((await deps.cases.get(c.id))?.status).toBe("research_failed");
    await deps.cases.setStatus(c.id, "ready");
    await failResearch(c.id, deps);
    expect((await deps.cases.get(c.id))?.status).toBe("ready");
  });

  it("keeps the original 180s budget when a failed phase retries", async () => {
    vi.useFakeTimers();
    const { deps, c, step, run } = await setup();
    vi.spyOn(deps.persist, "saveResults").mockRejectedValueOnce(new Error("retry me"));
    await expect(executeResearch(c.id, deps, step)).rejects.toThrow("retry me");
    vi.advanceTimersByTime(RESEARCH_TIMEOUT_MS + 1);
    await expect(executeResearch(c.id, deps, step)).rejects.toThrow("180s deadline");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cuts off a hung phase and prevents late persistence from publishing ready", async () => {
    vi.useFakeTimers();
    const { deps, c, step } = await setup();
    let resolve!: () => void;
    vi.spyOn(deps.persist, "saveResults").mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    const execution = executeResearch(c.id, deps, step);
    const rejected = expect(execution).rejects.toThrow("180s deadline");
    await vi.advanceTimersByTimeAsync(RESEARCH_TIMEOUT_MS);
    await rejected;
    await failResearch(c.id, deps);
    resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect((await deps.cases.get(c.id))?.status).toBe("research_failed");
  });
});

describe("research start API", () => {
  it("atomically claims concurrent requests: exactly one event and one 409", async () => {
    const { c } = await setup();
    const send = vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["event-id"] });
    const responses = await Promise.all([post(c.id), post(c.id)]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(send).toHaveBeenCalledExactlyOnceWith({ name: "case/research.requested", data: { caseId: c.id } });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.wiring).not.toHaveBeenCalled();
  });

  it("uses one conditional DB update to claim a case", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "case" }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as ConstructorParameters<typeof DbCaseStore>[0];
    expect(await new DbCaseStore(db).compareAndSetStatus("case", ["confirmed"], "researching")).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ status: "researching" });
    returning.mockResolvedValueOnce([]);
    expect(await new DbCaseStore(db).compareAndSetStatus("case", ["confirmed"], "researching")).toBe(false);
  });

  it("returns 503 and releases the case on dispatch failure", async () => {
    const { deps, c } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(inngest, "send").mockRejectedValue(new Error("delivery failed"));
    expect((await post(c.id)).status).toBe(503);
    expect((await deps.cases.get(c.id))?.status).toBe("research_failed");
  });

  it.each(["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"])("falls back in process without %s", async (key) => {
    const { c, deps } = await setup();
    vi.stubEnv(key, "");
    const send = vi.spyOn(inngest, "send");
    expect((await post(c.id)).status).toBe(202);
    expect(send).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]![0]();
    expect((await deps.cases.get(c.id))?.status).toBe("ready");
  });

  it("uses offline execution even with Inngest keys configured", async () => {
    const { c, deps } = await setup();
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    const send = vi.spyOn(inngest, "send");
    expect((await post(c.id)).status).toBe(202);
    expect(send).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]![0]();
    expect((await deps.cases.get(c.id))?.status).toBe("ready");
  });

  it("marks failures in offline wiring too", async () => {
    const { c, deps } = await setup();
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.wiring.mockRejectedValueOnce(new Error("fixtures unavailable"));
    expect((await post(c.id)).status).toBe(202);
    await mocks.after.mock.calls[0]![0]();
    expect((await deps.cases.get(c.id))?.status).toBe("research_failed");
  });

  it("validates IDs, existence and confirmation without dispatching", async () => {
    const { c, deps } = await setup();
    expect((await post("invalid")).status).toBe(400);
    expect((await post("11111111-1111-4111-8111-111111111111")).status).toBe(404);
    await deps.cases.setStatus(c.id, "draft");
    expect((await post(c.id)).status).toBe(409);
  });

  it("rate limits the 4th start on a case within an hour: 429 + Retry-After, case not claimed", async () => {
    const { deps, c } = await setup();
    vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["event-id"] });
    for (let i = 0; i < 3; i++) {
      expect((await post(c.id)).status).toBe(202);
      await deps.cases.setStatus(c.id, "confirmed");
    }
    const res = await post(c.id);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect((await deps.cases.get(c.id))?.status).toBe("confirmed");
  });
});
