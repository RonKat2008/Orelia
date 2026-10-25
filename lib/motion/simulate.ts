import type { AgentName, AgentRunStatus } from "@/lib/contracts";
import { AGENT_ORDER, type SwarmAgent } from "./status";

/** A scripted swarm run for the motion lab and demos. Pure: no timers here. */

export interface SwarmEvent {
  at: number;
  name: AgentName;
  status: AgentRunStatus;
  counts?: Record<string, number>;
}

interface Script {
  start: number;
  finish: number;
  outcome: Extract<AgentRunStatus, "done" | "failed" | "not_implemented">;
  counts?: Record<string, number>;
}

const SCRIPT: Record<AgentName, Script> = {
  literature: { start: 300, finish: 5200, outcome: "done", counts: { papers: 14, evidence: 31 } },
  trials: { start: 500, finish: 4300, outcome: "done", counts: { trials: 4, evidence: 9 } },
  identity: { start: 800, finish: 6100, outcome: "done", counts: { specialists: 7, evidence: 12 } },
  centers: { start: 1100, finish: 6900, outcome: "done", counts: { centers: 5, evidence: 10 } },
  advocacy: { start: 1400, finish: 3800, outcome: "done", counts: { groups: 3, evidence: 6 } },
  aid: { start: 1700, finish: 5600, outcome: "failed" },
  rare_network: { start: 1200, finish: 4600, outcome: "done", counts: { records: 2, evidence: 2 } },
  disease_funds: { start: 1500, finish: 5000, outcome: "done", counts: { records: 1, evidence: 1 } },
  second_opinion: { start: 1800, finish: 6400, outcome: "done", counts: { records: 3, evidence: 3 } },
  contact_finder: { start: 2000, finish: 7700, outcome: "done", counts: { contacts: 6, evidence: 6 } },
  network: { start: 600, finish: 900, outcome: "not_implemented" },
  logistics: { start: 700, finish: 1000, outcome: "not_implemented" },
};

export const SIMULATION_LENGTH_MS = 8000;

export function initialSwarm(): SwarmAgent[] {
  return AGENT_ORDER.map((name) => ({ name, status: "queued" }));
}

/** Builds the time-ordered event list: queued → running (with progress) → outcome. */
export function buildSwarmSchedule(): SwarmEvent[] {
  const events: SwarmEvent[] = [];
  for (const name of AGENT_ORDER) {
    const script = SCRIPT[name];
    if (script.outcome !== "not_implemented") {
      events.push({ at: script.start, name, status: "running" });
    }
    if (script.counts && script.outcome === "done") {
      const half = Object.fromEntries(
        Object.entries(script.counts).map(([k, n]) => [k, Math.max(1, Math.floor(n / 2))]),
      );
      events.push({ at: Math.round((script.start + script.finish) / 2), name, status: "running", counts: half });
    }
    events.push({ at: script.finish, name, status: script.outcome, counts: script.counts });
  }
  return events.sort((a, b) => a.at - b.at);
}

/** Applies one event immutably. */
export function applySwarmEvent(agents: readonly SwarmAgent[], event: SwarmEvent): SwarmAgent[] {
  return agents.map((agent) =>
    agent.name === event.name
      ? { ...agent, status: event.status, counts: event.counts ?? agent.counts }
      : agent,
  );
}
