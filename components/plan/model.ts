import type { ContactPlan, PlanChannel, PlanEdit, PlanStep, ResourcePlan, StepPurpose, WaitFor } from '@/lib/plan/contract';

export const CHANNEL_LABELS: Record<PlanChannel, string> = {
  voice: 'Phone call',
  email: 'Email',
  web_form: 'Online form',
};

export const PURPOSE_LABELS: Record<StepPurpose, string> = {
  intro: 'Introduce',
  apply: 'Apply',
  follow_up: 'Follow up',
  confirm: 'Confirm',
};

export const KIND_LABELS: Record<string, string> = {
  expert: 'Specialist',
  institution: 'Care center',
  trial: 'Clinical trial',
  organization: 'Organization',
};

/** waitFor in plain words. */
export function waitText(waitFor: WaitFor, isFirst: boolean): string {
  if (waitFor === 'none') return isFirst ? 'Start here' : 'Right after the previous step';
  if (waitFor === 'reply') return 'If there is no reply yet';
  const match = /^business_days:(\d+)$/.exec(waitFor);
  if (!match) return 'Later';
  const days = Number(match[1]);
  return `If no reply after ${days} business ${days === 1 ? 'day' : 'days'}`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Short label for an evidence id (ids can be long uuids). */
export function shortEvidenceId(id: string): string {
  const tail = id.replace(/[^A-Za-z0-9]/g, '').slice(-6);
  return `Source ${tail || id.slice(0, 6)}`;
}

export function sortedSteps(resource: ResourcePlan): PlanStep[] {
  return [...resource.steps].sort((a, b) => a.order - b.order);
}

export function enabledStepCount(plan: ContactPlan): number {
  return plan.resources.reduce((n, r) => n + r.steps.filter(s => s.enabled).length, 0);
}

function mapResource(plan: ContactPlan, resourceKey: string, fn: (r: ResourcePlan) => ResourcePlan): ContactPlan {
  return { ...plan, resources: plan.resources.map(r => (r.resourceKey === resourceKey ? fn(r) : r)) };
}

/** Optimistic local application of a toggle. Pure. */
export function withToggle(plan: ContactPlan, resourceKey: string, stepId: string, enabled: boolean): ContactPlan {
  return mapResource(plan, resourceKey, r => ({ ...r, steps: r.steps.map(s => (s.id === stepId ? { ...s, enabled } : s)) }));
}

/** New id order after moving one step up (-1) or down (+1); null when it cannot move. */
export function movedIds(resource: ResourcePlan, stepId: string, delta: -1 | 1): string[] | null {
  const ids = sortedSteps(resource).map(s => s.id);
  const from = ids.indexOf(stepId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Optimistic local application of a reorder. Pure. */
export function withOrder(plan: ContactPlan, resourceKey: string, stepIds: string[]): ContactPlan {
  return mapResource(plan, resourceKey, r => ({
    ...r,
    steps: r.steps.map(s => ({ ...s, order: stepIds.indexOf(s.id) + 1 })),
  }));
}

export function toggleEdit(resourceKey: string, stepId: string, enabled: boolean): PlanEdit {
  return { type: 'toggle', resourceKey, stepId, enabled };
}
