/**
 * Orchestrator wiring for the two new phases:
 *  - "needs" (Understanding your condition): runs in parallel with the searches; the searches that benefit wait for
 *    its search terms at most NEEDS_WAIT_MS from the start of the fan-out, so it adds <= ~10 s to the critical path.
 *  - "judge" (Final judge): replaces the curator; its result is saved per case and converted to curator tiers.
 */
import { hasClaudeCredentials } from "@/lib/ai/gateway";
import type { CareNeeds, CaseInput, NeedsSearchTerms } from "@/lib/contracts";
import { isOffline } from "@/lib/env";
import type { ValidatedCuration } from "./curator";
import { runJudge } from "./judge";
import { runNeedsAnalyst } from "./needs";
import { getNeedsStore, type NeedsStore } from "./needs/store";
import type { RankedEntry } from "./persist";
import { caseSlug } from "./research/shared";
import type { RunStore } from "./run-store";

export const NEEDS_WAIT_MS = 10_000;

export type NeedsFn = (caseId: string, c: CaseInput, store: RunStore) => Promise<CareNeeds | undefined>;
export type JudgeFn = (caseId: string, c: CaseInput, ranked: RankedEntry[], needs: CareNeeds | undefined, store: RunStore) => Promise<ValidatedCuration>;

/** Default needs analyst: offline whenever WAYFINDER_OFFLINE is set or no model credentials exist (tests, CI). */
export const defaultNeeds: NeedsFn = async (caseId, c, store) => {
  const offline = isOffline() || !hasClaudeCredentials();
  return runNeedsAnalyst(caseId, c, {
    store,
    offline,
    briefSources: async (id) => {
      const { getConditionBriefStore } = await import("@/lib/condition-brief/store");
      return (await getConditionBriefStore().latest(id))?.sources ?? [];
    },
    documents: async (id) => {
      const { getDocumentStore } = await import("@/lib/case-docs");
      return (await getDocumentStore().list(id)).map((d) => ({ kind: d.kind }));
    },
  });
};

export function makeDefaultJudge(needsStore: () => NeedsStore = getNeedsStore): JudgeFn {
  return async (caseId, c, ranked, needs, store) => {
    const { result, curation } = await runJudge(caseId, c, ranked, needs, { store, offlineKey: caseSlug(c) });
    try {
      await needsStore().saveJudge(result);
    } catch (e) {
      console.error(`[judge] failed to save judge result for case ${caseId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return curation;
  };
}

/** Search terms promise bounded by the wait budget measured from `startedAt`. Never rejects. */
export function boundedTerms(needs: Promise<CareNeeds | undefined>, startedAt: number, waitMs = NEEDS_WAIT_MS): Promise<NeedsSearchTerms | undefined> {
  const remaining = Math.max(0, startedAt + waitMs - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), remaining);
  });
  return Promise.race([needs.then((n) => n?.searchTerms).catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
}
