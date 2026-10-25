import { getServices } from "@/app/api/cases/_lib/services";
import { isoOrNull, truncate } from "../db";
import type { ActivityEvent, ActivitySource } from "../types";

interface RunLike {
  id: string;
  agent: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  outputSummary: string | null;
}

/** Pure: agent_runs rows -> events. Run errors are shortened; they are server-written, not user text. */
export function runEvents(runs: RunLike[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const run of runs) {
    const started = isoOrNull(run.startedAt);
    if (started) out.push({ id: `run:${run.id}:started`, at: started, kind: "agent_started", contactId: null, title: `${run.agent} agent started`, meta: { agent: run.agent } });
    const finished = isoOrNull(run.finishedAt);
    if (!finished) continue;
    if (run.status === "failed") {
      out.push({ id: `run:${run.id}:failed`, at: finished, kind: "agent_failed", contactId: null, title: `${run.agent} agent failed`, detail: run.error ? truncate(run.error, 200) : undefined, meta: { agent: run.agent } });
    } else if (run.status === "done") {
      out.push({ id: `run:${run.id}:finished`, at: finished, kind: "agent_finished", contactId: null, title: `${run.agent} agent finished`, detail: run.outputSummary ? truncate(run.outputSummary, 240) : undefined, meta: { agent: run.agent } });
    }
  }
  return out;
}

export const agentRunsSource: ActivitySource = {
  name: "agent-runs",
  async load(caseId) {
    return { events: runEvents(await getServices().runs.listByCase(caseId)) };
  },
};
