import type { AgentName } from "@/lib/contracts";
import { AGENT_NAMES, type SwarmEvent } from "./stream";

const STUBS = new Set<AgentName>(["contact_finder", "network", "logistics"]);

/** Synthetic example links so the preview shows the source chips. Not real findings. */
const PREVIEW_SOURCES: Partial<Record<AgentName, SwarmEvent["sources"]>> = {
  literature: [
    { url: "https://pubmed.ncbi.nlm.nih.gov/", title: "Example publication record", verified: true },
    { url: "https://pmc.ncbi.nlm.nih.gov/", title: "Example open-access article", verified: true },
  ],
  trials: [{ url: "https://clinicaltrials.gov/", title: "Example recruiting study", verified: true }],
  identity: [{ url: "https://npiregistry.cms.hhs.gov/", title: "Example registry entry", verified: true }],
  centers: [{ url: "https://www.cancer.gov/research/infrastructure/cancer-centers", title: "Example center listing", verified: true }],
  advocacy: [{ url: "https://rarediseases.org/", title: "Example advocacy group", verified: false }],
  aid: [{ url: "https://www.cancer.gov/about-cancer/managing-care/track-care-costs", title: "Example aid program", verified: false }],
};

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
        sources: PREVIEW_SOURCES[agent],
      });
    }
  }
  return events;
}

export function playMockStream(onEvent: (event: SwarmEvent) => void, onEnd: () => void, intervalMs = 700): () => void {
  const script = mockSwarmScript();
  let index = 0;
  const timer = setInterval(() => {
    const next = script[index];
    if (!next) {
      clearInterval(timer);
      onEnd();
      return;
    }
    onEvent(next);
    index += 1;
  }, intervalMs);
  return () => clearInterval(timer);
}
