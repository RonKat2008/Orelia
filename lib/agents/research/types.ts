import type { AgentName, CaseInput, NeedsSearchTerms, ResearchResult } from "@/lib/contracts";
import type { RunStore } from "@/lib/agents/run-store";
import type { HAIKU } from "@/lib/agents/models";
import type { SourcePorts } from "./source-ports";

export interface ResearchContext {
  ports: SourcePorts;
  store: RunStore;
  caseId: string;
  /** Cited snippets from the patient's own document library (untrusted data; never for search queries). */
  medicalHistory?: string;
  /**
   * Needs-derived search terms (from the needs analyst, sourced items only). Resolves to undefined when needs are
   * unavailable or not ready within the orchestrator's wait budget; agents then run their base queries only.
   */
  needsTerms?: () => Promise<NeedsSearchTerms | undefined>;
}

export interface ResearchAgent {
  name: AgentName;
  model: typeof HAIKU;
  run(caseRecord: CaseInput, ctx: ResearchContext): Promise<ResearchResult>;
}
