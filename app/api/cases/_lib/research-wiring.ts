import { isOffline } from "@/lib/env";
import type { RankFn } from "@/lib/agents/placeholder-rank";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { researchAgents } from "@/lib/agents/research";
import type { SourcePorts } from "@/lib/agents/research/source-ports";
import type { ResearchAgent } from "@/lib/agents/research/types";

export interface ResearchWiring {
  agents: readonly ResearchAgent[];
  ports: SourcePorts;
  /** Undefined -> caller falls back to the placeholder ranker. Swap to lib/ranking/rank.ts once merged. */
  rank?: RankFn;
}

/**
 * Single place that binds agents, source ports and ranker. Offline uses recorded-fixture ports.
 * TODO(task #4): live mode needs an adapter from lib/sources/* to SourcePorts, and rank from lib/ranking/rank.ts.
 */
export async function getResearchWiring(): Promise<ResearchWiring> {
  if (!isOffline()) {
    throw new Error("Live source ports are not wired yet (waiting on lib/sources); set WAYFINDER_OFFLINE=1");
  }
  return { agents: researchAgents, ports: createFixturePorts() };
}
