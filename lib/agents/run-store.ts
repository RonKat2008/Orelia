import type { Usage } from "@/lib/ai/usage";
import { emptyUsage } from "@/lib/ai/usage";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentRuns } from "@/db/schema";
import type { AgentRunStatus } from "@/lib/contracts";

export interface RunRecord extends Partial<Usage> {
  id: string;
  caseId: string;
  agent: string;
  status: AgentRunStatus;
  counts: Record<string, number> | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  outputSummary: string | null;
}

export interface RunUpdate extends Partial<Usage> {
  status: AgentRunStatus;
  counts?: Record<string, number>;
  error?: string;
  outputSummary?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface RunStore {
  create(caseId: string, agent: string): Promise<string>;
  update(runId: string, patch: RunUpdate): Promise<void>;
  listByCase(caseId: string): Promise<RunRecord[]>;
  /** Drop every run row of a case (start of a fresh research attempt, so retries never stack rows). */
  deleteByCase?(caseId: string): Promise<void>;
}

function applyPatch(run: RunRecord, patch: RunUpdate): RunRecord {
  return {
    ...run,
    status: patch.status,
    tokensIn: patch.tokensIn ?? run.tokensIn,
    tokensOut: patch.tokensOut ?? run.tokensOut,
    cacheRead: patch.cacheRead ?? run.cacheRead,
    cacheCreation: patch.cacheCreation ?? run.cacheCreation,
    costUsd: patch.costUsd === undefined ? run.costUsd : patch.costUsd,
    counts: patch.counts ?? run.counts,
    error: patch.error ?? run.error,
    outputSummary: patch.outputSummary ?? run.outputSummary,
    startedAt: patch.startedAt ?? run.startedAt,
    finishedAt: patch.finishedAt ?? run.finishedAt,
  };
}

/** In-memory store for tests and offline demos. */
export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();

  async create(caseId: string, agent: string): Promise<string> {
    const id = randomUUID();
    this.runs.set(id, {
      id, caseId, agent, status: "queued", counts: null, ...emptyUsage(),
      startedAt: null, finishedAt: null, error: null, outputSummary: null,
    });
    return id;
  }

  async update(runId: string, patch: RunUpdate): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown agent run ${runId}`);
    this.runs.set(runId, applyPatch(run, patch));
  }

  async listByCase(caseId: string): Promise<RunRecord[]> {
    return [...this.runs.values()].filter((r) => r.caseId === caseId);
  }

  async deleteByCase(caseId: string): Promise<void> {
    for (const [id, run] of this.runs) if (run.caseId === caseId) this.runs.delete(id);
  }
}

/** Postgres-backed store over the agent_runs table (read by the SSE stream). */
export class DbRunStore implements RunStore {
  constructor(private readonly db: ReturnType<typeof getDb> = getDb()) {}

  async create(caseId: string, agent: string): Promise<string> {
    const [row] = await this.db
      .insert(agentRuns)
      .values({ caseId, agent, status: "queued" })
      .returning({ id: agentRuns.id });
    if (!row) throw new Error("Failed to insert agent_runs row");
    return row.id;
  }

  async update(runId: string, patch: RunUpdate): Promise<void> {
    const set: Partial<typeof agentRuns.$inferInsert> = { status: patch.status };
    for (const key of ["tokensIn", "tokensOut", "cacheRead", "cacheCreation", "costUsd"] as const) {
      if (patch[key] !== undefined) Object.assign(set, { [key]: patch[key] });
    }
    if (patch.counts !== undefined) set.counts = patch.counts;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.outputSummary !== undefined) set.outputSummary = patch.outputSummary;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
    if (patch.finishedAt !== undefined) set.finishedAt = patch.finishedAt;
    await this.db.update(agentRuns).set(set).where(eq(agentRuns.id, runId));
  }

  async listByCase(caseId: string): Promise<RunRecord[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.caseId, caseId))
      .orderBy(asc(agentRuns.startedAt));
    return rows as RunRecord[];
  }

  async deleteByCase(caseId: string): Promise<void> {
    await this.db.delete(agentRuns).where(eq(agentRuns.caseId, caseId));
  }
}
