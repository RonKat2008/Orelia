/** Patient edits to a stored plan (toggle, reorder, approve). Pure and immutable: returns a new plan or an error. */
import type { ContactPlan, PlanEdit, ResourcePlan } from './contract';
import { summarizePlan } from './summary';

export type PlanEditResult = { ok: true; plan: ContactPlan } | { ok: false; error: string };

type Draft = { resources: ResourcePlan[]; status: ContactPlan['status']; approvedAt: string | null };
type Step = { ok: true; draft: Draft } | { ok: false; error: string };

function withResource(d: Draft, key: string, fn: (r: ResourcePlan) => ResourcePlan | string): Step {
  const idx = d.resources.findIndex(r => r.resourceKey === key);
  if (idx === -1) return { ok: false, error: `Unknown resource: ${key}` };
  const next = fn(d.resources[idx]);
  if (typeof next === 'string') return { ok: false, error: next };
  return { ok: true, draft: { resources: d.resources.map((r, i) => (i === idx ? next : r)), status: 'draft', approvedAt: null } };
}

function applyOne(d: Draft, edit: PlanEdit, now: Date): Step {
  switch (edit.type) {
    case 'toggle':
      return withResource(d, edit.resourceKey, r => {
        if (!r.steps.some(s => s.id === edit.stepId)) return `Unknown step: ${edit.stepId}`;
        return { ...r, steps: r.steps.map(s => (s.id === edit.stepId ? { ...s, enabled: edit.enabled } : s)) };
      });
    case 'reorder':
      return withResource(d, edit.resourceKey, r => {
        const ids = r.steps.map(s => s.id);
        const unique = new Set(edit.stepIds);
        const isPermutation = edit.stepIds.length === ids.length && unique.size === ids.length && edit.stepIds.every(id => ids.includes(id));
        if (!isPermutation) return 'Reorder must list every step of the resource exactly once';
        return { ...r, steps: edit.stepIds.map((id, i) => ({ ...r.steps.find(s => s.id === id)!, order: i + 1 })) };
      });
    case 'approve':
      if (!d.resources.some(r => r.steps.some(s => s.enabled))) return { ok: false, error: 'Turn on at least one step before approving the plan' };
      return { ok: true, draft: { ...d, status: 'approved', approvedAt: now.toISOString() } };
  }
}

export function applyPlanEdits(plan: ContactPlan, edits: readonly PlanEdit[], now: Date): PlanEditResult {
  if (edits.length === 0) return { ok: false, error: 'No edits to apply' };
  let draft: Draft = { resources: plan.resources, status: plan.status, approvedAt: plan.approvedAt };
  for (const edit of edits) {
    const res = applyOne(draft, edit, now);
    if (!res.ok) return res;
    draft = res.draft;
  }
  return {
    ok: true,
    plan: {
      ...plan,
      ...draft,
      version: plan.version + 1,
      summary: summarizePlan(draft.resources),
      updatedAt: now.toISOString(),
    },
  };
}
