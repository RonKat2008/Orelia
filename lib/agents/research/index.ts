import type { AgentName } from "@/lib/contracts";
import { advocacyAgent } from "./advocacy";
import { aidAgent } from "./aid";
import { centersAgent } from "./centers";
import { contactFinderAgent } from "./contact-finder";
import { identityAgent } from "./identity";
import { literatureAgent } from "./literature";
import { logisticsAgent } from "./logistics";
import { networkAgent } from "./network";
import { trialsAgent } from "./trials";
import type { ResearchAgent } from "./types";

/** Fixed order, one entry per AgentName. */
export const researchAgents: ReadonlyArray<ResearchAgent> = [
  literatureAgent,
  trialsAgent,
  identityAgent,
  centersAgent,
  advocacyAgent,
  aidAgent,
  contactFinderAgent,
  networkAgent,
  logisticsAgent,
];

export const researchRegistry: Readonly<Record<AgentName, ResearchAgent>> = Object.fromEntries(
  researchAgents.map((a) => [a.name, a]),
) as Record<AgentName, ResearchAgent>;

export type { ResearchAgent, ResearchContext } from "./types";
export type { SourcePorts } from "./source-ports";
