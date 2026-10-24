import { agentNameSchema, type CaseInput, type ResearchResult } from "@/lib/contracts";
import type { CaseStore } from "./case-store";
import type { Persist, RankedEntry } from "./persist";
import { rank as defaultRank } from "@/lib/ranking/rank";
import type { RunStore, RunUpdate } from "./run-store";
import type { ResearchAgent, ResearchContext } from "./research/types";
import type { SourcePorts } from "./research/source-ports";
import { toCandidate, type RankFn } from "./signals";
import { verifyWithProposals, type Proposer, type VerifyOutput } from "./verifier";

export interface OrchestratorDeps {
  store: RunStore;
  ports: SourcePorts;
  /** Defaults to the deterministic lib/ranking/rank.ts. */
  rank?: RankFn;
  persist: Persist;
  cases: CaseStore;
  agents: readonly ResearchAgent[];
  /** Optional Opus verifier pass: proposes merges/conflicts only. Leave undefined offline. */
  proposer?: Proposer;
  /** Hard per-agent ceiling so one hung agent cannot hold the run past the 3-minute target. */
  agentTimeoutMs?: number;
}

export interface ResearchSummary {
  runStatuses: Record<string, string>;
  verify: { kept: number; dropped: number; merged: number; conflicts: number };
  candidates: number;
  verified: VerifyOutput;
  ranked: RankedEntry[];
}

const DEFAULT_AGENT_TIMEOUT_MS = 150_000;

/**
 * Agents that go through runAgent() create their own run row. To keep ONE card per agent we pre-create
 * all rows as 'queued' and hand each agent a store whose first create() for its name returns that row.
 */
class AdoptingStore implements RunStore {
  private readonly pre = new Map<string, string>();

  constructor(
    private readonly inner: RunStore,
    preCreated: Map<string, string>,
  ) {
    for (const [k, v] of preCreated) this.pre.set(k, v);
  }

  async create(caseId: string, agent: string): Promise<string> {
    const adopted = this.pre.get(agent);
    if (adopted) {
      this.pre.delete(agent);
      return adopted;
    }
    return this.inner.create(caseId, agent);
  }
  update(runId: string, patch: RunUpdate) {
    return this.inner.update(runId, patch);
  }
  listByCase(caseId: string) {
    return this.inner.listByCase(caseId);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function finishRun(store: RunStore, runId: string, outcome: PromiseSettledResult<ResearchResult>): Promise<string> {
  const finishedAt = new Date();
  if (outcome.status === "rejected") {
    await store.update(runId, { status: "failed", error: errMessage(outcome.reason), finishedAt });
    return "failed";
  }
  const r = outcome.value;
  if (r.status === "ok") {
    await store.update(runId, {
      status: "done",
      counts: { records: r.records.length, evidence: r.evidence.length },
      outputSummary: `${r.records.length} records, ${r.evidence.length} evidence`,
      finishedAt,
    });
    return "done";
  }
  if (r.status === "not_implemented") {
    await store.update(runId, { status: "not_implemented", outputSummary: "not implemented", finishedAt });
    return "not_implemented";
  }
  await store.update(runId, { status: "failed", error: r.message, finishedAt });
  return "failed";
}

export async function runResearch(caseId: string, deps: OrchestratorDeps): Promise<ResearchSummary> {
  const caseRecord = await deps.cases.get(caseId);
  if (!caseRecord) throw new Error(`Case ${caseId} not found`);
  await deps.cases.setStatus(caseId, "researching");

  // 1. Queue all nine first so the UI shows every card immediately.
  const names = agentNameSchema.options;
  const runIds = new Map<string, string>();
  for (const name of names) runIds.set(name, await deps.store.create(caseId, name));

  const agentStore = new AdoptingStore(deps.store, runIds);
  const ctx: ResearchContext = { ports: deps.ports, store: agentStore, caseId };
  const timeoutMs = deps.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

  // 2. Fan out. allSettled: one failing agent never sinks the rest.
  const runStatuses: Record<string, string> = {};
  const settled = await Promise.all(
    names.map(async (name) => {
      const runId = runIds.get(name)!;
      const agent = deps.agents.find((a) => a.name === name);
      let outcome: PromiseSettledResult<ResearchResult>;
      if (!agent) {
        outcome = { status: "fulfilled", value: { status: "not_implemented" } };
      } else {
        await deps.store.update(runId, { status: "running", startedAt: new Date() });
        // allSettled on a single promise keeps rejection handling uniform with the fan-out contract.
        [outcome] = await Promise.allSettled([withTimeout(agent.run(caseRecord, ctx), timeoutMs, name)]);
      }
      runStatuses[name] = await finishRun(deps.store, runId, outcome);
      return outcome;
    }),
  );

  const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));

  // 3. Verify (deterministic), 4. rank per resource kind, 5. persist.
  try {
    return await finalizeCase(caseId, caseRecord, results, runStatuses, deps);
  } catch (e) {
    await deps.cases.setStatus(caseId, "research_failed");
    throw e;
  }
}

async function finalizeCase(
  caseId: string,
  caseRecord: CaseInput,
  results: ResearchResult[],
  runStatuses: Record<string, string>,
  deps: OrchestratorDeps,
): Promise<ResearchSummary> {
  const verified = await verifyWithProposals(results, deps.proposer, caseRecord);
  const ranked: RankedEntry[] = [];
  const kinds = [...new Set(verified.kept.map((k) => k.resource.kind))].sort();
  for (const kind of kinds) {
    const group = verified.kept.filter((k) => k.resource.kind === kind);
    const out = (deps.rank ?? defaultRank)(group.map((rec) => toCandidate(rec, verified.kept, caseRecord)));
    for (const r of out) ranked.push({ record: r.record, score: r.score, rank: r.rank, breakdown: r.breakdown });
  }
  await deps.persist.saveResults(caseId, ranked);
  await deps.cases.setStatus(caseId, "ready");

  return {
    runStatuses,
    verify: {
      kept: verified.kept.length,
      dropped: verified.dropped.length,
      merged: verified.merged.length,
      conflicts: verified.conflicts.length,
    },
    candidates: ranked.length,
    verified,
    ranked,
  };
}
