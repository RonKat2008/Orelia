import type { ContactPlan, PlanResourceInput } from './contract';
import { parsePlanContactPoints } from './contact-points';
import { stepTarget } from './rules';

/**
 * Re-check a (stored or refined) plan against the current inputs: every step must target a contact point parsed from
 * its own resource's evidence on the step's channel, and cite only that resource's evidence ids. Returns the problems
 * found (empty when the plan is sound). Execution should refuse a step that fails this check.
 */
export function validatePlanAgainstInputs(plan: ContactPlan, inputs: readonly PlanResourceInput[]): string[] {
  const byKey = new Map<string, PlanResourceInput>(inputs.map(i => [`${i.targetKind}:${i.targetId}`, i]));
  return plan.resources.flatMap(r => {
    const input = byKey.get(r.resourceKey);
    if (!input) return r.steps.length ? [`${r.resourceKey}: resource is no longer selected`] : [];
    const points = parsePlanContactPoints(input.evidence);
    const ids = new Set(input.evidence.map(e => e.id));
    return r.steps.flatMap(s => {
      const ok = points.some(cp => cp.channel === s.channel && stepTarget(cp).targetRef === s.targetRef && s.evidenceIds.includes(cp.evidenceId));
      const problems: string[] = [];
      if (!ok) problems.push(`${r.resourceKey}/${s.id}: target is not a verified ${s.channel} contact point of this resource`);
      if (!s.evidenceIds.every(id => ids.has(id))) problems.push(`${r.resourceKey}/${s.id}: cites evidence of another resource`);
      return problems;
    });
  });
}
