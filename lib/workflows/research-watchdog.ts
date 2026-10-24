import { failOpenRuns, lastRunActivity } from "@/lib/agents/phase-runs";
import type { CaseStore } from "@/lib/agents/case-store";
import type { RunStore } from "@/lib/agents/run-store";

/** No agent_runs progress for this long means the function that was researching is gone (e.g. killed at maxDuration). */
export const STUCK_AFTER_MS = 6 * 60_000;
export const STUCK_MESSAGE =
  "Research stopped responding and was ended automatically. Nothing was lost; start the search again.";

/** Statuses in which research is in flight. */
const IN_FLIGHT = ["researching"] as const;

export interface WatchdogDeps {
  cases: Pick<CaseStore, "get" | "compareAndSetStatus">;
  runs: Pick<RunStore, "listByCase" | "update">;
  /** Injectable clock so tests never sleep. */
  now?: () => Date;
  thresholdMs?: number;
}

export type ReapOutcome = "not_researching" | "active" | "reaped" | "raced";

/**
 * Fails a case whose research went quiet. Compare-and-set makes it idempotent and race-safe against a
 * finishing run: if the case left 'researching' meanwhile, nothing is touched.
 */
export async function reapIfStuck(caseId: string, deps: WatchdogDeps): Promise<ReapOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const record = await deps.cases.get(caseId);
  if (!record || !IN_FLIGHT.some((s) => s === record.status)) return "not_researching";
  const runs = await deps.runs.listByCase(caseId);
  // A case with no run rows at all predates the heartbeat row; its creation time is the best clock we have.
  const last = lastRunActivity(runs) ?? new Date(record.createdAt);
  if (now.getTime() - last.getTime() <= (deps.thresholdMs ?? STUCK_AFTER_MS)) return "active";
  if (!(await deps.cases.compareAndSetStatus(caseId, IN_FLIGHT, "research_failed"))) return "raced";
  await failOpenRuns(deps.runs as RunStore, caseId, STUCK_MESSAGE, now);
  return "reaped";
}

export interface SweepDeps extends WatchdogDeps {
  listResearching(): Promise<string[]>;
}

export async function sweepStuckResearch(deps: SweepDeps): Promise<{ checked: number; reaped: string[] }> {
  const ids = await deps.listResearching();
  const reaped: string[] = [];
  for (const id of ids) {
    try {
      if ((await reapIfStuck(id, deps)) === "reaped") reaped.push(id);
    } catch (e) {
      console.error(`[research-watchdog] ${id}`, e instanceof Error ? e.message : "error");
    }
  }
  return { checked: ids.length, reaped };
}
