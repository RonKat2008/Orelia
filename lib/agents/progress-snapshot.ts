import { isTerminalRun, ATTEMPT_AGENT } from "./phase-runs";
import type { CaseStore } from "./case-store";
import type { RunRecord, RunStore } from "./run-store";

/** The nine research agents plus the post-search rows that are not cards; the stream finishes when none is still open. */
export const EXPECTED_AGENTS = 9;
export const TERMINAL_CASE = new Set(["ready", "research_failed"]);

export interface ProgressSnapshot {
  caseId: string;
  caseStatus?: string;
  runs: RunRecord[];
  /** Server clock, so the browser can time phases without trusting its own clock. */
  serverTime: string;
}

export async function loadProgress(
  caseId: string,
  deps: { cases: Pick<CaseStore, "get">; runs: Pick<RunStore, "listByCase"> },
  now: Date = new Date(),
): Promise<ProgressSnapshot> {
  const [runs, current] = await Promise.all([deps.runs.listByCase(caseId), deps.cases.get(caseId)]);
  return { caseId, caseStatus: current?.status, runs, serverTime: now.toISOString() };
}

/** True when the run is over and persisted: the case is terminal and no agent row is still open. */
export function isFinished(snapshot: ProgressSnapshot): boolean {
  if (!snapshot.caseStatus || !TERMINAL_CASE.has(snapshot.caseStatus)) return false;
  if (snapshot.caseStatus === "research_failed") return true;
  const rows = snapshot.runs.filter((r) => r.agent !== ATTEMPT_AGENT);
  return rows.length >= EXPECTED_AGENTS && rows.every((r) => isTerminalRun(r.status));
}
