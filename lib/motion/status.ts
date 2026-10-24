import type { AgentName, AgentRunStatus } from "@/lib/contracts";

export type StatusTone = "quiet" | "pending" | "verified" | "failed" | "neutral";

export interface StatusPresentation {
  tone: StatusTone;
  label: string;
  /** True once the agent will not change again. */
  settled: boolean;
}

export const STATUS_PRESENTATION: Record<AgentRunStatus, StatusPresentation> = {
  queued: { tone: "quiet", label: "Waiting to start", settled: false },
  running: { tone: "pending", label: "Searching", settled: false },
  done: { tone: "verified", label: "Finished", settled: true },
  failed: { tone: "failed", label: "Could not finish", settled: true },
  not_implemented: { tone: "neutral", label: "Not available yet", settled: true },
};

export const AGENT_LABEL: Record<AgentName, string> = {
  literature: "Published research",
  trials: "Clinical trials",
  identity: "Specialist identity",
  centers: "Specialty centers",
  advocacy: "Advocacy groups",
  aid: "Financial and travel aid",
  contact_finder: "Intake contacts",
  network: "Insurance network",
  logistics: "Travel and logistics",
};

/** Short names for the constellation map, where space is tight. */
export const AGENT_SHORT_LABEL: Record<AgentName, string> = {
  literature: "Research",
  trials: "Trials",
  identity: "Specialists",
  centers: "Centers",
  advocacy: "Advocacy",
  aid: "Aid",
  contact_finder: "Contacts",
  network: "Network",
  logistics: "Logistics",
};

export const AGENT_ORDER: readonly AgentName[] = [
  "literature",
  "trials",
  "identity",
  "centers",
  "advocacy",
  "aid",
  "contact_finder",
  "network",
  "logistics",
];

export interface SwarmAgent {
  name: AgentName;
  status: AgentRunStatus;
  /** Free-form counts from agent_runs.counts, e.g. { records: 12, evidence: 30 }. */
  counts?: Record<string, number>;
}

export function totalCount(counts?: Record<string, number>): number {
  if (!counts) return 0;
  return Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
}

export function describeCounts(counts?: Record<string, number>): string {
  if (!counts) return "";
  const parts = Object.entries(counts)
    .filter(([, n]) => Number.isFinite(n))
    .map(([key, n]) => `${n} ${key.replace(/_/g, " ")}`);
  return parts.join(", ");
}

/** The sentence a screen reader hears when an agent changes state. */
export function announceAgent(agent: SwarmAgent): string {
  const label = AGENT_LABEL[agent.name];
  const { label: statusLabel } = STATUS_PRESENTATION[agent.status];
  const counts = describeCounts(agent.counts);
  return counts ? `${label}: ${statusLabel.toLowerCase()}, ${counts}.` : `${label}: ${statusLabel.toLowerCase()}.`;
}

export function summarizeSwarm(agents: readonly SwarmAgent[]): string {
  const available = agents.filter((a) => a.status !== "not_implemented");
  const unavailable = agents.length - available.length;
  const settled = available.filter((a) => STATUS_PRESENTATION[a.status].settled).length;
  const running = available.filter((a) => a.status === "running").length;
  const tail = unavailable > 0 ? ` ${unavailable} not available yet.` : "";
  if (available.length > 0 && settled === available.length) {
    return `All ${available.length} research agents have finished.${tail}`;
  }
  return `${settled} of ${available.length} research agents finished, ${running} searching now.${tail}`;
}
