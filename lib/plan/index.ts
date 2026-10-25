import type { ContactPlan, PlanResourceInput } from './contract';
import { buildDeterministicPlan } from './rules';
import { refinePlan, type PlanCompleter } from './refine';

export * from './contract';
export { parsePlanContactPoints, webFormEvidence, normalizeHttpUrl, WEB_FORM_ORIGINS, type PlanContactPoint, type PlanContactOrigin, type WebFormOrigin, type WebFormPoint } from './contact-points';
export { buildDeterministicPlan, planResource, ruleFamily, selectPlanInputs, NO_CHANNEL_REASON, REGISTRY_NO_ONLINE_REASON, type RuleFamily } from './rules';
export { refinePlan, sanitizeReason, defaultPlanCompleter, REFINE_TIMEOUT_MS, type ChatMessage, type PlanCompleter, type RefineOptions } from './refine';
export { applyPlanEdits, type PlanEditResult } from './edits';
export { summarizePlan } from './summary';
export { validatePlanAgainstInputs } from './validate';

export interface BuildPlanOptions {
  now: Date;
  /** Run the optional LLM refinement (deterministic fallback on any failure). */
  llm?: boolean;
  complete?: PlanCompleter;
  signal?: AbortSignal;
}

/** Deterministic plan, optionally refined by the model. Never throws on model failure; never sends anything. */
export async function buildContactPlan(caseId: string, inputs: readonly PlanResourceInput[], opts: BuildPlanOptions): Promise<ContactPlan> {
  const base = buildDeterministicPlan(caseId, inputs, { now: opts.now });
  if (!opts.llm) return base;
  return refinePlan(base, inputs, { complete: opts.complete, signal: opts.signal });
}
