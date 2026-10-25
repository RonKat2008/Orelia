import type { ContactPlan, PlanChannel, PlanEdit, PlanStep, ResourcePlan, StepPurpose, WaitFor } from '@/lib/plan/contract';
import { DEMO_LABELS, isDemoFormFor } from '@/lib/outreach/demo-destinations-shared';

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
  verify: 'Verify',
};

export const KIND_LABELS: Record<string, string> = {
  expert: 'Specialist',
  institution: 'Care center',
  trial: 'Clinical trial',
  organization: 'Organization',
};

/** "Introduce by email", "Verify by phone call": purpose and channel, each said once. */
export function stepLabel(step: Pick<PlanStep, 'purpose' | 'channel'>, opts: { registry?: boolean } = {}): string {
  const purpose = opts.registry && (step.purpose === 'intro' || step.purpose === 'apply') ? REGISTRY_PURPOSE : PURPOSE_LABELS[step.purpose];
  return `${purpose} by ${CHANNEL_LABELS[step.channel].toLowerCase()}`;
}

/** Patient registries are joined, not "introduced to". Label only; the plan's steps are unchanged. */
const REGISTRY_PURPOSE = 'Join the registry';

/** True when the plan rule names a patient registry (label only, no plan logic). */
export function isRegistryPlan(resource: Pick<ResourcePlan, 'rule'>): boolean {
  return /registry/i.test(resource.rule);
}

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

// Same value as DEMO_COORDINATOR_EVIDENCE_PREFIX in lib/plan/contact-points (kept literal: that module is server-side).
const DEMO_COORDINATOR_EVIDENCE_PREFIX = 'contact_point:demo_coordinator:';

/** Short label for an evidence id (ids can be long uuids). */
export function shortEvidenceId(id: string): string {
  if (id.startsWith(DEMO_COORDINATOR_EVIDENCE_PREFIX)) return 'Demo coordinator (test inbox)';
  const tail = id.replace(/[^A-Za-z0-9]/g, '').slice(-6);
  return `Source ${tail || id.slice(0, 6)}`;
}

/** Evidence badge text: the source site (or registry) when known, else the short id. */
export function evidenceBadgeText(id: string, meta?: { label: string } | null): string {
  if (id.startsWith(DEMO_COORDINATOR_EVIDENCE_PREFIX)) return shortEvidenceId(id);
  return meta?.label ? `Source: ${meta.label}` : shortEvidenceId(id);
}

/** Honest note on a plan step while demo mode swaps its destination for a Orelia test one. */
export function demoStepLabel(channel: PlanChannel, callsRingTestNumber: boolean): string {
  if (channel === 'email') return DEMO_LABELS.email;
  if (channel === 'web_form') return DEMO_LABELS.web_form;
  return callsRingTestNumber ? DEMO_LABELS.voiceTestNumber : DEMO_LABELS.voice;
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

export interface StepContext {
  resourceName: string;
  /** 1-based position among the resource's enabled steps. */
  number: number;
  total: number;
  purpose: StepPurpose;
  channel: PlanChannel;
}

function contextFor(resource: ResourcePlan, match: (s: PlanStep) => boolean): StepContext | null {
  const enabled = sortedSteps(resource).filter(s => s.enabled);
  const index = enabled.findIndex(match);
  if (index === -1) return null;
  const s = enabled[index];
  return { resourceName: resource.name, number: index + 1, total: enabled.length, purpose: s.purpose, channel: s.channel };
}

/** Which plan step an outbox draft (one first message per contact) belongs to. Pure; null when unknown. */
export function draftStepContext(plan: ContactPlan | null, draft: { contactId: string; channel: 'email' | 'voice' }): StepContext | null {
  const resource = plan?.resources.find(r => r.contactId === draft.contactId);
  if (!resource) return null;
  const firstMessage = contextFor(resource, s => s.channel === draft.channel && s.purpose !== 'follow_up');
  return firstMessage ?? contextFor(resource, s => s.channel === draft.channel);
}

/** Which web_form step a drafted application belongs to (matched by the step's form URL). Pure. */
export function applicationStepContext(plan: ContactPlan | null, app: { contactId: string | null; url: string }): StepContext | null {
  for (const resource of plan?.resources ?? []) {
    if (app.contactId && resource.contactId && resource.contactId !== app.contactId) continue;
    const ctx = contextFor(resource, s => s.channel === 'web_form' && (s.targetRef === app.url || isDemoFormFor(app.url, resource.resourceKey, s.targetRef)));
    if (ctx) return ctx;
  }
  return null;
}

export function stepContextText(ctx: StepContext): string {
  return `Step ${ctx.number} of ${ctx.total} in the plan for ${ctx.resourceName}: ${PURPOSE_LABELS[ctx.purpose]} by ${CHANNEL_LABELS[ctx.channel].toLowerCase()}`;
}

/* ---------- After approve: what was drafted ---------- */

export interface MaterializedItem {
  status: string;
  channel?: string;
}

/** Defensive read of PATCH approve's `materialized` array. Unknown shapes become []. */
export function parseMaterialized(value: unknown): MaterializedItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const { status, channel } = item as { status?: unknown; channel?: unknown };
    if (typeof status !== 'string') return [];
    return [{ status, ...(typeof channel === 'string' ? { channel } : {}) }];
  });
}

/** Only real drafts: email/voice drafts and web_form applications drafted. Not scheduled, follow_up_plan or mismatches. */
export function draftsReadyCount(items: MaterializedItem[]): number {
  return items.filter(i => i.status === 'drafted' || i.status === 'application_drafted').length;
}

export interface ApproveOutcome {
  count: number;
  headline: string;
  detail: string;
}

export function approveOutcome(items: MaterializedItem[]): ApproveOutcome {
  const count = draftsReadyCount(items);
  if (count > 0) {
    return {
      count,
      headline: `${count} ${count === 1 ? 'draft' : 'drafts'} ready in the outbox`,
      detail: 'Read each one and approve it yourself. Nothing is sent until you do.',
    };
  }
  const has = (s: string) => items.some(i => i.status === s);
  const headline = 'Plan approved. Nothing to review in the outbox yet';
  if (items.length === 0) {
    return { count, headline, detail: 'No drafts were written. You can still open the outbox to write one yourself.' };
  }
  if (has('channel_mismatch')) {
    return { count, headline, detail: 'A step is on a channel that contact is not set up for, so no draft was written. Check the plan channels.' };
  }
  if (has('scheduled') || has('follow_up_plan')) {
    return { count, headline, detail: 'The remaining steps are scheduled or follow-ups that wait for earlier steps. They will appear here when due.' };
  }
  return { count, headline, detail: 'No drafts could be written right now. Nothing was sent.' };
}

/* ---------- Tracker: plan steps per contact ---------- */

const FINISHED_STATES = new Set(['connected', 'declined', 'stalled']);

function afterText(waitFor: WaitFor): string {
  if (waitFor === 'none') return 'right after the previous step';
  if (waitFor === 'reply') return 'if there is no reply yet';
  const match = /^business_days:(\d+)$/.exec(waitFor);
  if (!match) return 'later';
  const days = Number(match[1]);
  return `after ${days} business ${days === 1 ? 'day' : 'days'}`;
}

const DUE_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function dueText(nextAt: string | null | undefined): string {
  if (!nextAt) return '';
  const at = new Date(nextAt);
  return Number.isFinite(at.getTime()) ? ` (due ${DUE_FORMAT.format(at)})` : '';
}

export interface ContactPlanLine {
  current: string;
  next: string;
}

/**
 * Current step rule: messages sent = sentCount when known, else 0 for a drafted contact and 1 for any later state
 * (the first message went out). Current step = the enabled step at index max(sent - 1, 0), clamped to the last step:
 * a drafted contact is on step 1, and each sent message moves the contact one step on. Next = the step after it, with
 * its wait. A finished contact (connected, declined, stalled) has no next step. Pure.
 */
export function contactPlanLine(
  plan: ContactPlan | null,
  contact: { contactId: string; state: string; sentCount?: number; /** ISO time the workflow scheduled the next step. */ nextAt?: string | null },
): ContactPlanLine | null {
  const resource = plan?.resources.find(r => r.contactId === contact.contactId);
  if (!plan || !resource) return null;
  const steps = sortedSteps(resource).filter(s => s.enabled);
  if (steps.length === 0) return null;
  const sent = contact.sentCount ?? (contact.state === 'drafted' ? 0 : 1);
  const index = Math.min(Math.max(sent - 1, 0), steps.length - 1);
  const cur = steps[index];
  const current = `Step ${index + 1} of ${steps.length}: ${PURPOSE_LABELS[cur.purpose]} by ${CHANNEL_LABELS[cur.channel].toLowerCase()}`;
  if (plan.status !== 'approved') return { current, next: 'Plan not approved yet' };
  const nextStep = steps[index + 1];
  if (!nextStep || FINISHED_STATES.has(contact.state)) return { current, next: 'Last step' };
  return { current, next: `Next: ${PURPOSE_LABELS[nextStep.purpose]} by ${CHANNEL_LABELS[nextStep.channel].toLowerCase()}, ${afterText(nextStep.waitFor)}${dueText(contact.nextAt)}` };
}
