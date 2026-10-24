import { isOffline } from "@/lib/env";
import { researchAgents } from "@/lib/agents/research";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { createLivePorts } from "@/lib/agents/research/live-ports";
import type { SourcePorts } from "@/lib/agents/research/source-ports";
import type { ResearchAgent } from "@/lib/agents/research/types";

export interface ResearchWiring {
  agents: readonly ResearchAgent[];
  ports: SourcePorts;
}

/**
 * Single place that binds agents, source ports and ranker. Offline uses recorded-fixture ports; live uses the
 * rate-limited lib/sources clients (NCBI_API_KEY / EXA_API_KEY from the environment). One wiring per research run.
 */
export async function getResearchWiring(): Promise<ResearchWiring> {
  return { agents: researchAgents, ports: isOffline() ? createFixturePorts() : createLivePorts() };
}
