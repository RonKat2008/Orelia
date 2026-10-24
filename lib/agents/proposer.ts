import { z } from "zod";
import { modelFor } from "@/config/models";
import { buildProposerPrompt, PROPOSER_SYSTEM } from "./prompts/proposer";
import type { RunStore } from "./run-store";
import { runAgent, type MessagesClient } from "./runtime";
import type { Proposer } from "./verifier";

export const proposalsSchema = z.object({
  merges: z.array(z.object({
    keys: z.tuple([z.string().min(1), z.string().min(1)]),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).optional(),
  }).strict()),
  conflicts: z.array(z.object({ key: z.string().min(1), reason: z.string().min(1) }).strict()),
}).strict();

export interface MergeProposerDeps {
  caseId: string;
  /** Fixture stem under fixtures/llm/proposer (one per synthetic disease). */
  offlineKey: string;
  store: RunStore;
  client?: MessagesClient;
}

/** Plug into orchestrator deps.proposer. The verifier remains the authority on every merge. */
export function createMergeProposer(deps: MergeProposerDeps): Proposer {
  return async (kept) => {
    if (kept.length === 0) return { merges: [], conflicts: [] };
    try {
      return await runAgent({
        name: "proposer",
        model: modelFor("verifier"),
        system: PROPOSER_SYSTEM,
        prompt: buildProposerPrompt(kept),
        tools: [],
        maxTurns: 1,
        output: proposalsSchema,
        ...deps,
      });
    } catch {
      // Runtime records the failure; optional deduplication must not discard verified research.
      return { merges: [], conflicts: [] };
    }
  };
}
