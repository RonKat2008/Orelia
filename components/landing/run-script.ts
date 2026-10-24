/**
 * The scripted, clearly illustrative "agents at work" run shown in the hero.
 * Pure data + a pure frame function so the panel stays a thin renderer and the
 * choreography is unit-tested. Nothing here is a real result.
 */

export type AgentStatus = "waiting" | "searching" | "done";

export interface ScriptAgent {
  id: string;
  label: string;
  /** What the agent looks for, in plain words. */
  task: string;
  startsAt: number;
  doneAt: number;
  /** Sample result count shown when done. */
  found: number;
}

export interface ScriptSource {
  domain: string;
  /** When the chip appears (ms into the run). */
  at: number;
}

export const RUN_AGENTS: readonly ScriptAgent[] = [
  { id: "literature", label: "Literature", task: "Published case reports", startsAt: 500, doneAt: 2400, found: 6 },
  { id: "trials", label: "Trials", task: "Recruiting studies", startsAt: 800, doneAt: 3100, found: 2 },
  { id: "centers", label: "Centers", task: "Specialists and clinics", startsAt: 1100, doneAt: 3800, found: 4 },
  { id: "advocacy", label: "Advocacy", task: "Patient organizations", startsAt: 1400, doneAt: 4400, found: 3 },
  { id: "aid", label: "Aid", task: "Travel and cost help", startsAt: 1700, doneAt: 5000, found: 2 },
] as const;

export const RUN_SOURCES: readonly ScriptSource[] = [
  { domain: "pubmed.ncbi.nlm.nih.gov", at: 2400 },
  { domain: "clinicaltrials.gov", at: 3100 },
  { domain: "npiregistry.cms.hhs.gov", at: 3800 },
] as const;

export const RUN_TIMES = {
  curated: 5900,
  drafted: 7800,
  /** Hold the finished state, then start again. */
  end: 16000,
} as const;

/** Moments the panel re-renders at; between them nothing changes. */
export const RUN_KEYFRAMES: readonly number[] = [
  0,
  ...new Set(
    [
      ...RUN_AGENTS.flatMap((agent) => [agent.startsAt, agent.doneAt]),
      ...RUN_SOURCES.map((source) => source.at),
      RUN_TIMES.curated,
      RUN_TIMES.drafted,
    ].sort((a, b) => a - b),
  ),
];

export interface RunFrame {
  agents: { id: string; status: AgentStatus }[];
  visibleSources: number;
  curated: boolean;
  drafted: boolean;
  doneCount: number;
  caption: string;
}

export function agentStatusAt(agent: ScriptAgent, ms: number): AgentStatus {
  if (ms >= agent.doneAt) return "done";
  if (ms >= agent.startsAt) return "searching";
  return "waiting";
}

export function frameAt(ms: number): RunFrame {
  const agents = RUN_AGENTS.map((agent) => ({ id: agent.id, status: agentStatusAt(agent, ms) }));
  const doneCount = agents.filter((agent) => agent.status === "done").length;
  const curated = ms >= RUN_TIMES.curated;
  const drafted = ms >= RUN_TIMES.drafted;
  let caption = "Reading the case details you confirmed";
  if (drafted) caption = "Draft ready. Waiting for your approval";
  else if (curated) caption = "Verified, with a plan to reach each one";
  else if (doneCount === agents.length) caption = "Checking every claim against its source";
  else if (ms >= RUN_AGENTS[0].startsAt) caption = "Agents searching public sources";
  return {
    agents,
    visibleSources: RUN_SOURCES.filter((source) => ms >= source.at).length,
    curated,
    drafted,
    doneCount,
    caption,
  };
}

/** The finished state: what reduced-motion visitors see, and where a paused run can rest. */
export const FINAL_FRAME: RunFrame = frameAt(RUN_TIMES.end);

/** Index of the keyframe after `index`, wrapping to 0 at the end of the run. */
export function nextKeyframe(index: number): number {
  return index + 1 >= RUN_KEYFRAMES.length ? 0 : index + 1;
}

/** Delay in ms from keyframe `index` to the next one (the last one holds until RUN_TIMES.end). */
export function delayAfter(index: number): number {
  const current = RUN_KEYFRAMES[index] ?? 0;
  const next = RUN_KEYFRAMES[index + 1];
  return next === undefined ? RUN_TIMES.end - current : next - current;
}
