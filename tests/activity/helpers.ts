import { runEvents } from "@/lib/activity/sources/agent-runs";

export function agentRunEventsForTest() {
  return runEvents([
    { id: "r1", agent: "experts", status: "done", startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:01:00Z"), error: null, outputSummary: "12 found" },
    { id: "r2", agent: "trials", status: "failed", startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:02:00Z"), error: "timeout", outputSummary: null },
  ]);
}
