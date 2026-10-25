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
  rare_network: "Research networks and registries",
  disease_funds: "Disease funds",
  second_opinion: "Expert centers and second opinions",
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
  finishedAt?: string;
};

/** Post-search pipeline stages, reported by their own agent_runs rows. */
export type PipelinePhase = "needs" | "verify" | "rank" | "judge";
export type PhaseRun = { status: AgentRunStatus; startedAt?: string; finishedAt?: string; summary?: string; error?: string };
export type PhaseRuns = Partial<Record<PipelinePhase, PhaseRun>>;

/** "curator" rows come from runs before the final judge replaced the curator; a "judge" row wins when both exist. */
const PHASE_BY_AGENT: Record<string, PipelinePhase> = { needs: "needs", verifier: "verify", ranker: "rank", judge: "judge", curator: "judge" };

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
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish(),
});

const runsEventSchema = z.object({
  caseStatus: z.string().optional(),
  runs: z.array(runRowSchema),
  serverTime: z.string().optional(),
});

export type RunsSnapshot = { caseStatus?: string; cards: AgentCardState[]; phases: PhaseRuns; serverTime?: string };

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
      finishedAt: run.finishedAt ?? undefined,
    };
  });
  const phases: PhaseRuns = {};
  for (const run of parsed.data.runs) {
    const phase = PHASE_BY_AGENT[run.agent];
    if (!phase || (run.agent === "curator" && parsed.data.runs.some((r) => r.agent === "judge"))) continue;
    phases[phase] = {
      status: run.status,
      startedAt: run.startedAt ?? undefined,
      finishedAt: run.finishedAt ?? undefined,
      summary: run.outputSummary ?? undefined,
      error: run.error ?? undefined,
    };
  }
  return { caseStatus: parsed.data.caseStatus, cards, phases, serverTime: parsed.data.serverTime };
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
  { id: "judge", label: "Final judge", description: "Keeps what meets your needs, with a reason for each" },
] as const;

export type PhaseIndex = 0 | 1 | 2 | 3 | 4;

const phaseDone = (run?: PhaseRun) => run?.status === "done" || run?.status === "not_implemented";

/**
 * Where the pipeline is. Searches first; once they settle the verifier, ranker and curator rows say which
 * later stage is active. Without those rows (older runs) the settled searches show as "Verify" until ready.
 */
export function derivePhase(cards: AgentCardState[], caseStatus?: string, phases: PhaseRuns = {}): PhaseIndex {
  if (caseStatus === "ready") return 4;
  if (!cards.every((card) => isSettled(card.status))) return 0;
  if (phaseDone(phases.rank)) return 3;
  if (phaseDone(phases.verify)) return 2;
  return 1;
}

export const PHASE_ACTIVE_LABEL: Record<PipelinePhase, string> = {
  needs: "Understanding your condition",
  verify: "Checking every claim has a source",
  rank: "Ranking what fits",
  judge: "Final judge checking each match against your needs",
};

export type PhaseTimer = { phase: PipelinePhase; label: string; startedAtMs: number | null; detail?: string };

/** Which timer to show, or null while searching / after the run. startedAtMs (server time) is null until known. */
export function activePhaseTimer(cards: AgentCardState[], caseStatus: string | undefined, phases: PhaseRuns): PhaseTimer | null {
  if (caseStatus === "ready" || caseStatus === "research_failed") return null;
  if (!cards.every((card) => isSettled(card.status))) return null;
  const index = derivePhase(cards, caseStatus, phases);
  const phase: PipelinePhase = index === 1 ? "verify" : index === 2 ? "rank" : "judge";
  const toMs = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? Date.parse(iso) : null);
  // A phase that has not logged its start yet began when the stage before it finished.
  const settledAt = Math.max(0, ...cards.map((card) => toMs(card.finishedAt) ?? 0)) || null;
  const before = phase === "verify" ? settledAt : toMs(phases[phase === "rank" ? "verify" : "rank"]?.finishedAt);
  const run = phases[phase];
  const detail = run?.status === "running" && run.summary ? run.summary : undefined;
  return { phase, label: PHASE_ACTIVE_LABEL[phase], startedAtMs: toMs(run?.startedAt) ?? before, ...(detail ? { detail } : {}) };
}

export type NeedsLine = {
  state: "waiting" | "running" | "done" | "unavailable";
  label: string;
  detail?: string;
  startedAtMs: number | null;
  finishedAtMs: number | null;
};

/**
 * "Understanding your condition": the needs analyst runs alongside the searches. Shown as its own line with a timer
 * while running and its summary (e.g. "4 specialties, ... 10 sources in 24.7s") when done.
 */
export function needsLine(phases: PhaseRuns): NeedsLine {
  const run = phases.needs;
  const toMs = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? Date.parse(iso) : null);
  const base = { label: PHASE_ACTIVE_LABEL.needs, startedAtMs: toMs(run?.startedAt), finishedAtMs: toMs(run?.finishedAt) };
  if (!run || run.status === "queued") return { ...base, state: "waiting", detail: "Starting with the searches" };
  if (run.status === "running") return { ...base, state: "running", detail: "Reading reference sources on what specialists and centers should offer" };
  if (run.status === "done") return { ...base, state: "done", detail: run.summary ?? "Needs profile ready" };
  return { ...base, state: "unavailable", detail: "Not available for this condition; the searches ran without it" };
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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
  rare_network: "Checking NIH rare disease research networks and registries",
  disease_funds: "Checking charity disease funds that are open or closed",
  second_opinion: "Finding NORD Centers of Excellence, second opinions and telehealth",
  contact_finder: "Finding intake contacts at the centers",
  network: "Checking insurance network details",
  logistics: "Working out travel and logistics",
};

export type ConnectionBadge = { tone: "teal" | "ok" | "neutral"; label: string; dot: boolean };

/**
 * The status badge beside the narration. "Live updates" only while the stream is open and the run
 * is still going; once the stream has reported the run complete the badge settles to a finished state.
 */
export function connectionBadge(connection: string, caseStatus?: string): ConnectionBadge {
  if (caseStatus === "ready") return { tone: "ok", label: "Run finished", dot: false };
  if (caseStatus === "research_failed") return { tone: "neutral", label: "Run stopped", dot: false };
  if (connection === "live") return { tone: "teal", label: "Live updates", dot: true };
  return { tone: "neutral", label: "Connecting…", dot: false };
}

/** One calm sentence about what is happening now. */
export function narrate(cards: AgentCardState[], caseStatus: string | undefined, lastActive?: AgentName, phases: PhaseRuns = {}): string {
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
  if (cards.every((card) => isSettled(card.status))) {
    const timer = activePhaseTimer(cards, caseStatus, phases);
    if (timer?.phase === "rank") return "Ranking what fits your case, with reasons.";
    if (timer?.phase === "judge") return "The final judge is checking each match against what you need, and writing why.";
    return "Checking that every claim has a source, then ranking what fits.";
  }
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
