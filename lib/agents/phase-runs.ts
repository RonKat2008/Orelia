import type { RunRecord, RunStore } from "./run-store";

/** agent_runs rows that report the post-search pipeline. The nine research agents keep their own rows. */
export const PHASE_AGENT = { verify: "verifier", rank: "ranker", curate: "curator" } as const;
/** Heartbeat row created when a research attempt is claimed; lets the watchdog date an attempt that never started. */
export const ATTEMPT_AGENT = "research";

const TERMINAL = new Set(["done", "failed", "not_implemented"]);
export const isTerminalRun = (status: string) => TERMINAL.has(status);

async function findRun(store: RunStore, caseId: string, agent: string): Promise<RunRecord | undefined> {
  return (await store.listByCase(caseId)).find((r) => r.agent === agent);
}

/** Finds the case's row for an agent or creates it (queued). Safe to call again on a step retry: never a second row. */
export async function ensureRun(store: RunStore, caseId: string, agent: string): Promise<string> {
  const existing = await findRun(store, caseId, agent);
  return existing ? existing.id : store.create(caseId, agent);
}

export async function beginPhase(store: RunStore, caseId: string, agent: string, now = new Date()): Promise<string> {
  const id = await ensureRun(store, caseId, agent);
  await store.update(id, { status: "running", startedAt: now });
  return id;
}

/** Marks a phase finished unless it already reached a terminal state. */
export async function settlePhase(
  store: RunStore, caseId: string, agent: string, summary?: string, now = new Date(),
): Promise<void> {
  const run = await findRun(store, caseId, agent);
  if (!run || isTerminalRun(run.status)) return;
  await store.update(run.id, { status: "done", ...(summary ? { outputSummary: summary } : {}), finishedAt: now });
}

/** Fails every run that is still queued or running, so a dead attempt never leaves a card spinning. */
export async function failOpenRuns(store: RunStore, caseId: string, message: string, now = new Date()): Promise<number> {
  const open = (await store.listByCase(caseId)).filter((r) => !isTerminalRun(r.status));
  for (const run of open) await store.update(run.id, { status: "failed", error: message, finishedAt: now });
  return open.length;
}

/** Newest timestamp any run reported. Null when no run has started or finished. */
export function lastRunActivity(runs: readonly Pick<RunRecord, "startedAt" | "finishedAt">[]): Date | null {
  let latest: Date | null = null;
  for (const run of runs) {
    for (const raw of [run.startedAt, run.finishedAt]) {
      if (!raw) continue;
      const at = raw instanceof Date ? raw : new Date(raw);
      if (!Number.isNaN(at.getTime()) && (!latest || at > latest)) latest = at;
    }
  }
  return latest;
}
