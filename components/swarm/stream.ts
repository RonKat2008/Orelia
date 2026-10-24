import { agentNameSchema, agentRunStatusSchema, type AgentName, type AgentRunStatus } from "@/lib/contracts";
import { z } from "zod";

export const AGENT_NAMES = agentNameSchema.options;

export const AGENT_LABELS: Record<AgentName, string> = {
  literature: "Literature",
  trials: "Trials",
  identity: "Clinician identity",
  centers: "Centers",
  advocacy: "Advocacy",
  aid: "Financial and travel aid",
  contact_finder: "Contact finder",
  network: "Referral network",
  logistics: "Logistics",
};

export const swarmEventSchema = z.object({
  type: z.literal("agent_run"),
  agent: agentNameSchema,
  status: agentRunStatusSchema,
  counts: z
    .object({
      records: z.number().int().nonnegative().optional(),
      evidence: z.number().int().nonnegative().optional(),
    })
    .optional(),
  error: z.string().optional(),
  outputSummary: z.string().optional(),
});

export type SwarmEvent = z.infer<typeof swarmEventSchema>;

export type AgentCardState = {
  agent: AgentName;
  status: AgentRunStatus;
  counts?: SwarmEvent["counts"];
  error?: string;
  outputSummary?: string;
};

export function initialAgents(): AgentCardState[] {
  return AGENT_NAMES.map((agent) => ({ agent, status: "queued" }));
}

export function applySwarmEvent(cards: AgentCardState[], event: SwarmEvent): AgentCardState[] {
  return cards.map((card) =>
    card.agent === event.agent
      ? {
          agent: event.agent,
          status: event.status,
          counts: event.counts ?? card.counts,
          error: event.error,
          outputSummary: event.outputSummary,
        }
      : card,
  );
}

export function parseSwarmEvent(data: string): SwarmEvent | null {
  try {
    const parsed = swarmEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const STUBS = new Set<AgentName>(["contact_finder", "network", "logistics"]);

export function mockSwarmScript(): SwarmEvent[] {
  const events: SwarmEvent[] = [];
  for (const agent of AGENT_NAMES) {
    events.push({ type: "agent_run", agent, status: "running" });
    if (STUBS.has(agent)) {
      events.push({
        type: "agent_run",
        agent,
        status: "not_implemented",
        outputSummary: "This agent is not part of the first milestone.",
      });
    } else {
      events.push({
        type: "agent_run",
        agent,
        status: "done",
        counts: { records: agent === "literature" ? 6 : 3, evidence: agent === "literature" ? 8 : 3 },
        outputSummary: "Preview counts from the typed mock stream.",
      });
    }
  }
  return events;
}

export function playMockStream(onEvent: (event: SwarmEvent) => void, intervalMs = 450): () => void {
  const script = mockSwarmScript();
  let index = 0;
  const timer = setInterval(() => {
    const next = script[index];
    if (!next) {
      clearInterval(timer);
      return;
    }
    onEvent(next);
    index += 1;
  }, intervalMs);
  return () => clearInterval(timer);
}
