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

export type SourceRef = { url: string; title?: string; verified: boolean };

export type AgentCardState = {
  agent: AgentName;
  status: AgentRunStatus;
  counts?: Record<string, number>;
  error?: string;
  outputSummary?: string;
  sources?: SourceRef[];
};

export function initialAgents(): AgentCardState[] {
  return AGENT_NAMES.map((agent) => ({ agent, status: "queued" }));
}

/* ---------------------------- stream parsing ---------------------------- */

const countsSchema = z.record(z.string(), z.number());

/** One agent_runs row as the stream route serialises it. */
const runRowSchema = z.object({
  agent: z.string(),
  status: agentRunStatusSchema,
  counts: countsSchema.nullish(),
  error: z.string().nullish(),
  outputSummary: z.string().nullish(),
});

const runsEventSchema = z.object({
  caseStatus: z.string().optional(),
  runs: z.array(runRowSchema),
});

export type RunsSnapshot = { caseStatus?: string; cards: AgentCardState[] };

/** Folds an agent_runs snapshot into the nine cards. Agents with no row yet stay queued. */
export function parseRunsSnapshot(data: string, previous: AgentCardState[] = initialAgents()): RunsSnapshot | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = runsEventSchema.safeParse(json);
  if (!parsed.success) return null;
  const byAgent = new Map(parsed.data.runs.map((run) => [run.agent, run]));
  const cards = previous.map((card) => {
    const run = byAgent.get(card.agent);
    if (!run) return card;
    return {
      ...card,
      status: run.status,
      counts: run.counts ?? card.counts,
      error: run.error ?? undefined,
      outputSummary: run.outputSummary ?? undefined,
    };
  });
  return { caseStatus: parsed.data.caseStatus, cards };
}

/* Single-agent events (used by the typed preview). */
export const swarmEventSchema = z.object({
  type: z.literal("agent_run"),
  agent: agentNameSchema,
  status: agentRunStatusSchema,
  counts: countsSchema.optional(),
  error: z.string().optional(),
  outputSummary: z.string().optional(),
  sources: z.array(z.object({ url: z.string(), title: z.string().optional(), verified: z.boolean() })).optional(),
});

export type SwarmEvent = z.infer<typeof swarmEventSchema>;

export function applySwarmEvent(cards: AgentCardState[], event: SwarmEvent): AgentCardState[] {
  return cards.map((card) =>
    card.agent === event.agent
      ? {
          agent: event.agent,
          status: event.status,
          counts: event.counts ?? card.counts,
          error: event.error,
          outputSummary: event.outputSummary,
          sources: event.sources ? [...(card.sources ?? []), ...event.sources] : card.sources,
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

/* ------------------------------- derivations ----------------------------- */

export const isSettled = (status: AgentRunStatus) => status !== "queued" && status !== "running";

export const PHASES = [
  { id: "search", label: "Search", description: "Nine researchers look in parallel" },
  { id: "verify", label: "Verify", description: "Every claim needs a source link" },
  { id: "rank", label: "Rank", description: "Fit to your case, with reasons" },
  { id: "curate", label: "Curate", description: "The best matches rise to the top" },
] as const;

export type PhaseIndex = 0 | 1 | 2 | 3 | 4;

/**
 * Where the pipeline is. The stream reports agent rows and the case status, not the
 * later steps, so after the searches settle we show "Verify" until the case is ready.
 */
export function derivePhase(cards: AgentCardState[], caseStatus?: string): PhaseIndex {
  if (caseStatus === "ready") return 4;
  return cards.every((card) => isSettled(card.status)) ? 1 : 0;
}

export function swarmTotals(cards: AgentCardState[]) {
  const settled = cards.filter((card) => isSettled(card.status)).length;
  const sum = (key: string) => cards.reduce((total, card) => total + (card.counts?.[key] ?? 0), 0);
  return { settled, total: cards.length, records: sum("records"), evidence: sum("evidence") };
}

export const NARRATIVE: Record<AgentName, string> = {
  literature: "Checking published papers on PubMed",
  trials: "Looking for recruiting trials on ClinicalTrials.gov",
  identity: "Confirming specialists in the national provider registry",
  centers: "Reading cancer and specialty center listings",
  advocacy: "Finding patient advocacy groups",
  aid: "Looking for travel and financial aid programs",
  contact_finder: "Finding intake contacts at the centers",
  network: "Checking insurance network details",
  logistics: "Working out travel and logistics",
};

/** One calm sentence about what is happening now. */
export function narrate(cards: AgentCardState[], caseStatus: string | undefined, lastActive?: AgentName): string {
  if (caseStatus === "research_failed") return "The search stopped before it finished.";
  if (caseStatus === "ready") {
    const { records, evidence } = swarmTotals(cards);
    return `Done. ${records} records kept, each with a source link (${evidence} sources checked).`;
  }
  const running = cards.filter((card) => card.status === "running");
  if (running.length > 0) {
    const lead = running.find((card) => card.agent === lastActive) ?? running[0];
    const others = running.length - 1;
    return `${NARRATIVE[lead.agent]}${others > 0 ? `, and ${others} more search${others === 1 ? "" : "es"}` : ""}…`;
  }
  if (cards.every((card) => isSettled(card.status))) return "Checking that every claim has a source, then ranking what fits.";
  return "Getting the researchers ready…";
}

/** What a screen reader hears when the swarm moves. Null when nothing worth saying changed. */
export function describeProgress(prev: AgentCardState[], next: AgentCardState[]): string | null {
  const finished = next.filter((card) => {
    const before = prev.find((p) => p.agent === card.agent);
    return isSettled(card.status) && before && !isSettled(before.status);
  });
  if (finished.length === 0) return null;
  const { settled, total } = swarmTotals(next);
  const names = finished
    .map((card) => {
      const word = card.status === "done" ? "finished" : card.status === "failed" ? "could not finish" : "is not available yet";
      return `${AGENT_LABELS[card.agent]} ${word}`;
    })
    .join(". ");
  return `${names}. ${settled} of ${total} searches settled.`;
}

/** Which agent card a source kind belongs to, when it is unambiguous. */
export function agentForSourceKind(kind: string): AgentName | null {
  switch (kind) {
    case "pubmed":
      return "literature";
    case "ctgov":
      return "trials";
    case "nppes":
      return "identity";
    case "nci":
      return "centers";
    default:
      return null;
  }
}

const shortlistSourceSchema = z.object({
  groups: z.record(
    z.string(),
    z.array(z.object({ evidence: z.array(z.object({ sourceUrl: z.string(), sourceKind: z.string(), claim: z.string().optional() })) })),
  ),
});

export type SourceWithAgent = SourceRef & { agent: AgentName | null };

/** Unique, verified source links behind the shortlist. The verifier drops claims with no source, so all are verified. */
export function sourcesFromShortlist(json: unknown, limit = 12): SourceWithAgent[] {
  const parsed = shortlistSourceSchema.safeParse(json);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: SourceWithAgent[] = [];
  for (const items of Object.values(parsed.data.groups)) {
    for (const item of items) {
      for (const ev of item.evidence) {
        if (seen.has(ev.sourceUrl)) continue;
        seen.add(ev.sourceUrl);
        out.push({ url: ev.sourceUrl, title: ev.claim, verified: true, agent: agentForSourceKind(ev.sourceKind) });
      }
    }
  }
  return out.slice(0, limit);
}
