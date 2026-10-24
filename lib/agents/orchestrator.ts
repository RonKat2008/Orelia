import { expertEligibility } from "@/lib/identity/eligibility";
import { agentNameSchema, type CareNeeds, type CaseInput, type ResearchResult } from "@/lib/contracts";
import type { CaseStore } from "./case-store";
import type { Persist, RankedEntry } from "./persist";
import { rank as defaultRank } from "@/lib/ranking/rank";
import type { RunStore, RunUpdate } from "./run-store";
import type { ResearchAgent, ResearchContext } from "./research/types";
import type { SourcePorts } from "./research/source-ports";
import { toCandidate, type RankFn } from "./signals";
import { getCurationStore, type CurationStore } from "./curator-store";
import type { ValidatedCuration } from "./curator";
import { boundedTerms, defaultNeeds, makeDefaultJudge, NEEDS_WAIT_MS, type JudgeFn, type NeedsFn } from "./needs-judge-phase";
import { verifyWithProposals, type Proposer, type VerifyOutput } from "./verifier";
import { enrichVerified } from "./contact-enrichment";
import { ATTEMPT_AGENT, PHASE_AGENT, beginPhase, ensureRun, failOpenRuns, settlePhase } from "./phase-runs";

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
  /** Durable adapters memoize these JSON-serializable phase outputs. */
  step?: ResearchStep;
  /** Shared durable deadline; prevents late persistence from publishing a timed-out run. */
  deadline?: number;
  /** Legacy curator override (tests). When set it replaces the judge phase. */
  curate?: (caseId: string, caseRecord: CaseInput, ranked: RankedEntry[]) => Promise<ValidatedCuration>;
  /** Needs analyst (runs in parallel with the searches). Defaults to runNeedsAnalyst; never throws. */
  needs?: NeedsFn;
  /** How long the searches that use needs terms may wait for them, from the start of the fan-out. */
  needsWaitMs?: number;
  /** Final judge (replaces the curator). Defaults to runJudge + saving the judge result. */
  judge?: JudgeFn;
  /** Where curation results are saved. Defaults to getCurationStore(). */
  curations?: CurationStore;
  /**
   * Cited snippets from the case owner's document library for the agents' prompt (untrusted data). Defaults to the
   * account library retriever; returns '' for anonymous cases. Pass `async () => ''` to disable.
   */
  medicalHistory?: (caseId: string, caseRecord: CaseInput) => Promise<string>;
}

export interface ResearchSummary {
  runStatuses: Record<string, string>;
  verify: { kept: number; dropped: number; merged: number; conflicts: number };
  candidates: number;
  verified: VerifyOutput;
  ranked: RankedEntry[];
  curation: { source: ValidatedCuration["source"]; best: number; suggested: string[] };
  /** Latency of the new phases (ms). needsWaitMs is how long the needs-driven searches waited for terms. */
  timings: { needsMs: number | null; needsWaitMs: number | null; judgeMs: number; fanoutMs: number };
  needs?: { fromCache: boolean; items: number; sources: number };
}

export interface ResearchStep {
  run<T>(id: string, work: () => Promise<T>): Promise<T>;
}

const ALL_FAILED_MIN = 2;
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

/** The case owner's library, searched for the condition: a cited, sanitized block, or '' (anonymous case / none). */
async function caseLibraryContext(caseId: string, caseRecord: CaseInput): Promise<string> {
  const { searchCaseLibrary } = await import("@/lib/accounts/case-link");
  const { historyContextBlock } = await import("@/lib/accounts/retrieve");
  const query = [caseRecord.diseaseName, caseRecord.subtype].filter(Boolean).join(" ");
  const { results } = await searchCaseLibrary(caseId, query, 4);
  return historyContextBlock(results, 500);
}

export async function runResearch(caseId: string, deps: OrchestratorDeps): Promise<ResearchSummary> {
  // Inngest throws control-flow signals while planning steps. Terminal failure belongs to
  // onFailure; catching a planning signal here would incorrectly fail a healthy case.
  if (deps.step) return runResearchPhases(caseId, deps);
  try {
    return await runResearchPhases(caseId, deps);
  } catch (e) {
    await deps.cases.setStatus(caseId, "research_failed");
    await failOpenRuns(deps.store, caseId, errMessage(e)).catch(() => 0);
    throw e;
  }
}

async function runResearchPhases(caseId: string, deps: OrchestratorDeps): Promise<ResearchSummary> {
  const step: ResearchStep = deps.step ?? { run: (_id, work) => work() };
  // All I/O belongs inside steps: replay must not reset a ready/failed case to researching.
  const queued = await step.run("queue", async () => {
    const caseRecord = await deps.cases.get(caseId);
    if (!caseRecord) throw new Error(`Case ${caseId} not found`);
    await deps.cases.setStatus(caseId, "researching");
    const runIds: [string, string][] = [];
    for (const name of agentNameSchema.options) runIds.push([name, await ensureRun(deps.store, caseId, name)]);
    return { caseRecord, runIds };
  });
  const { caseRecord } = queued;
  const names = agentNameSchema.options;
  const runIds = new Map(queued.runIds);

  const fanout = await step.run("run-agents", async () => {
    const agentStore = new AdoptingStore(deps.store, runIds);
    const fanoutStarted = Date.now();
    // "Understanding your condition" runs alongside the searches; it never throws.
    let needsMs: number | null = null;
    const needsStore = new AdoptingStore(deps.store, new Map([[PHASE_AGENT.needs, await ensureRun(deps.store, caseId, PHASE_AGENT.needs)]]));
    const needsPromise = (deps.needs ?? defaultNeeds)(caseId, caseRecord, needsStore)
      .catch((): CareNeeds | undefined => undefined)
      .finally(() => {
        needsMs = Date.now() - fanoutStarted;
      });
    let needsWaitMs: number | null = null;
    const terms = boundedTerms(needsPromise, fanoutStarted, deps.needsWaitMs ?? NEEDS_WAIT_MS).finally(() => {
      needsWaitMs = Date.now() - fanoutStarted;
    });
    const medicalHistory = await (deps.medicalHistory ?? caseLibraryContext)(caseId, caseRecord).catch(() => '');
    const ctx: ResearchContext = { ports: deps.ports, store: agentStore, caseId, needsTerms: () => terms, ...(medicalHistory ? { medicalHistory } : {}) };
    const timeoutMs = deps.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

    // 2. Fan out. allSettled: one failing agent never sinks the rest.
    const runStatuses: Record<string, string> = {};
    const settled = await Promise.all(
      names.map(async (name) => {
        const runId = runIds.get(name);
        if (!runId) throw new Error(`Missing run ID for ${name}`);
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
    const needs = (await needsPromise) ?? null;
    const timings = { needsMs, needsWaitMs: needsWaitMs as number | null, fanoutMs: Date.now() - fanoutStarted };
    return { results, runStatuses, needs, timings };
  });
  // Every source failed: an empty shortlist would look like success. End as failed so the patient can retry.
  const outcomes = Object.values(fanout.runStatuses);
  // (A single failed agent among stubs is a partial result, not a total outage.)
  if (!outcomes.includes("done") && outcomes.filter((o) => o === "failed").length >= ALL_FAILED_MIN) {
    const message = "Every research source failed, so there is nothing to show yet. Please try again.";
    await step.run("all-failed", async () => {
      await deps.cases.setStatus(caseId, "research_failed");
      await failOpenRuns(deps.store, caseId, message);
      return { failed: true };
    });
    throw new Error(message);
  }
  return finalizeCase(caseId, caseRecord, fanout.results, fanout.runStatuses, deps, step, fanout.needs ?? undefined, fanout.timings);
}

async function finalizeCase(
  caseId: string,
  caseRecord: CaseInput,
  results: ResearchResult[],
  runStatuses: Record<string, string>,
  deps: OrchestratorDeps,
  step: ResearchStep,
  needs: CareNeeds | undefined,
  timings: { needsMs: number | null; needsWaitMs: number | null; fanoutMs: number },
): Promise<ResearchSummary> {
  // Post-search phases are recorded as agent_runs rows so the stream can show verify -> rank -> curate live.
  const checked = await step.run("verify", async () => {
    await beginPhase(deps.store, caseId, PHASE_AGENT.verify);
    return verifyWithProposals(results, deps.proposer, caseRecord);
  });
  // Code-only contact enrichment: institution intake phones / role emails from their own site (bounded, never fails).
  const verified = await step.run("contacts", async () => {
    const out = await enrichVerified(checked, deps.ports.exa, new Date());
    await settlePhase(deps.store, caseId, PHASE_AGENT.verify, `${out.kept.length} records kept, ${out.dropped.length} dropped`);
    return out;
  });
  const ranked = await step.run("rank", async () => {
    await beginPhase(deps.store, caseId, PHASE_AGENT.rank);
    const ranked: RankedEntry[] = [];
    const kinds = [...new Set(verified.kept.map((k) => k.resource.kind))].sort();
    for (const kind of kinds) {
      const group = verified.kept.filter((k) => k.resource.kind === kind && (k.resource.kind !== "expert" || expertEligibility(k.resource, verified.kept.map((r) => r.resource)).eligible));
      const out = (deps.rank ?? defaultRank)(group.map((rec) => toCandidate(rec, verified.kept, caseRecord)));
      for (const r of out) ranked.push({ record: r.record, score: r.score, rank: r.rank, breakdown: r.breakdown });
    }
    await settlePhase(deps.store, caseId, PHASE_AGENT.rank, `${ranked.length} ranked`);
    return ranked;
  });
  // "Final judge" replaces the curator. Adopt one judge row so a step retry never stacks a second card.
  const judged = await step.run("judge", async () => {
    const started = Date.now();
    const judgeRun = await ensureRun(deps.store, caseId, PHASE_AGENT.judge);
    const adopting = new AdoptingStore(deps.store, new Map([[PHASE_AGENT.judge, judgeRun]]));
    await deps.store.update(judgeRun, { status: "running", startedAt: new Date() });
    const out = deps.curate
      ? await deps.curate(caseId, caseRecord, ranked)
      : await (deps.judge ?? makeDefaultJudge())(caseId, caseRecord, ranked, needs, adopting);
    const kept = out.tiers.filter((t) => t.tier !== "exclude").length;
    // No-op when the judge already settled its row with its own timing summary.
    await settlePhase(deps.store, caseId, PHASE_AGENT.judge, `${kept} kept, ${out.tiers.length - kept} dropped${out.source === "fallback" ? " (judge unavailable: scored order kept)" : ""}`);
    return { curation: out, judgeMs: Date.now() - started };
  });
  const curation = judged.curation;
  await step.run("persist", async () => {
    // Below-threshold experts stay research: saved for the read-only Experts trace, never as candidates.
    const research = verified.kept.filter((k) => k.resource.kind === "expert" && k.shortlistEligibility?.eligible !== true);
    await deps.persist.saveResults(caseId, ranked, research);
    try {
      await (deps.curations ?? getCurationStore()).save(caseId, ranked, curation);
    } catch (e) {
      console.error(`[curator] failed to save curation for case ${caseId}: ${errMessage(e)}`);
    }
    if (deps.deadline !== undefined && Date.now() >= deps.deadline) throw new Error("Research exceeded 180s deadline");
    await deps.cases.setStatus(caseId, "ready");
    await settlePhase(deps.store, caseId, ATTEMPT_AGENT, "research complete").catch(() => undefined);
    return { saved: ranked.length };
  });

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
    curation: {
      source: curation.source,
      best: curation.tiers.filter((t) => t.tier === "best").length,
      suggested: curation.suggested,
    },
    timings: { ...timings, judgeMs: judged.judgeMs },
    ...(needs
      ? {
          needs: {
            fromCache: needs.fromCache,
            items: needs.specialties.length + needs.centerCapabilities.length + needs.redFlags.length + needs.trialEligibility.length + needs.supportNeeds.length,
            sources: needs.sources.length,
          },
        }
      : {}),
  };
}
