/**
 * Contact-plan executor. Pure orchestration over injected deps (engine-neutral WorkflowStep, same as
 * lib/workflows/connection-workflow.ts). It NEVER sends by itself:
 *   - email / voice steps go through deps.dispatchGated, whose real implementation is the existing outbox path
 *     (patient approval -> checkOutbound -> channel). A step without an approved message reports 'awaiting_approval'.
 *   - web_form steps draft the application via the WebFormChannel (never submit); 'not_available' is recorded and
 *     the next step continues. Submission happens only in the application approval route, through checkOutbound.
 * Only an APPROVED plan (status 'approved' AND approvedAt set) is executable; disabled steps are skipped; at most
 * MAX_PLAN_RESOURCES resources run. A reply (or decline) from the contact stops that resource's remaining steps.
 *
 * waitFor: 'none' = run immediately; 'business_days:N' = wait N business days for a reply first (reply => stop);
 * 'reply' = run only if no reply has arrived yet (no waiting).
 */
import type { WorkflowStep } from '../workflows/engine';
import { CONTACT_REPLY } from '../workflows/engine';
import { scaleDeadline, type Clock } from '../workflows/clock';
import { addBusinessDays } from '../workflows/business-days';
import { MAX_PLAN_RESOURCES, type ContactPlan, type PlanStep, type ResourcePlan } from './contract';
import type { WebFormChannel } from './channels';

export type StepStatus =
  | 'sent'
  | 'already_sent'
  | 'awaiting_approval'
  | 'submitted'
  | 'not_available'
  | 'blocked'
  | 'skipped_reply'
  | 'skipped_disabled'
  | 'error';

export interface StepOutcome {
  caseId: string;
  resourceKey: string;
  stepId: string;
  channel: PlanStep['channel'];
  status: StepStatus;
  detail?: string;
}

export type DispatchResult = { status: 'sent' | 'already_sent' | 'awaiting_approval' | 'blocked'; detail?: string };

export interface PlanExecDeps {
  clock: Clock;
  tz?: string;
  /** Email/voice only. Must route through the existing outbox/approval/checkOutbound path; may never bypass it. */
  dispatchGated(input: { caseId: string; contactId: string; resource: ResourcePlan; step: PlanStep }): Promise<DispatchResult>;
  /** True when the contact replied or declined (stops remaining steps). */
  hasReply(contactId: string): Promise<boolean>;
  /** Drafts web forms (fill + screenshot + review task); submission happens only after the patient approves it. */
  webForm: WebFormChannel;
  /** Optional: verify steps write an awaiting-approval verification request (idempotent); nothing is dialed. */
  createVerification?(input: { caseId: string; resourceKey: string }): Promise<{ id: string }>;
  record(outcome: StepOutcome): Promise<void>;
  /**
   * Optional: the plan as stored right now. Checked before every step so a run stops when the patient edited, rebuilt
   * or un-approved the plan while it was waiting (a newer approval starts its own run).
   */
  reload?(caseId: string): Promise<ContactPlan | null>;
}

export function isExecutable(plan: ContactPlan | null | undefined): plan is ContactPlan {
  return !!plan && plan.status === 'approved' && !!plan.approvedAt && !Number.isNaN(Date.parse(plan.approvedAt));
}

/** Ordered, enabled steps per resource. Empty for a draft/unapproved plan. */
export function executableSteps(plan: ContactPlan | null | undefined): { resource: ResourcePlan; steps: PlanStep[] }[] {
  if (!isExecutable(plan)) return [];
  return plan.resources.slice(0, MAX_PLAN_RESOURCES).map(resource => ({
    resource,
    steps: [...resource.steps].filter(s => s.enabled).sort((a, b) => a.order - b.order),
  }));
}

/**
 * A follow-up is covered by the walk-away plan only when its first message is still going out. If the patient turned
 * the earlier intro/apply step(s) off and none is left on, the follow-up is the resource's first contact and is treated
 * like one (otherwise the resource would silently never be contacted).
 */
export function isOrphanFollowUp(resource: ResourcePlan, s: PlanStep): boolean {
  if (s.purpose !== 'follow_up') return false;
  const earlier = (resource.steps ?? []).filter(x => x.order < s.order && (x.purpose === 'intro' || x.purpose === 'apply'));
  return earlier.length > 0 && earlier.every(x => !x.enabled);
}

const BUSINESS_WAIT = /^business_days:(\d+)$/;

function matchContact(contactId: string): string {
  return `async.data.contactId == ${JSON.stringify(contactId)}`;
}

export async function executePlan(step: WorkflowStep, plan: ContactPlan, deps: PlanExecDeps): Promise<StepOutcome[]> {
  const groups = executableSteps(plan);
  const perResource = await Promise.all(groups.map(g => executeResource(step, plan.caseId, plan.version, g.resource, g.steps, deps)));
  return perResource.flat();
}

async function executeResource(
  step: WorkflowStep, caseId: string, version: number, resource: ResourcePlan, steps: PlanStep[], deps: PlanExecDeps,
): Promise<StepOutcome[]> {
  const out: StepOutcome[] = [];
  const key = resource.resourceKey;
  const note = async (s: PlanStep, status: StepStatus, detail?: string) => {
    const o: StepOutcome = { caseId, resourceKey: key, stepId: s.id, channel: s.channel, status, ...(detail ? { detail } : {}) };
    await step.run(`record:${key}:${s.id}`, () => deps.record(o).then(() => o));
    out.push(o);
  };
  // Disabled steps are filtered out by executableSteps; surface them as skipped for the audit trail.
  for (const s of resource.steps.filter(x => !x.enabled)) await note(s, 'skipped_disabled');

  for (const s of steps) {
    if (resource.contactId && await replied(step, key, s, resource.contactId, deps)) {
      await note(s, 'skipped_reply', 'contact replied; remaining steps stopped');
      break;
    }
    const wait = BUSINESS_WAIT.exec(s.waitFor);
    if (wait && resource.contactId && !isOrphanFollowUp(resource, s)) {
      const days = Number(wait[1]);
      const deadline = await step.run(`deadline:${key}:${s.id}`, () => {
        const now = deps.clock.now();
        const real = addBusinessDays(now, days, deps.tz);
        return scaleDeadline(now, real, deps.clock.scale).toISOString();
      });
      const reply = await step.waitForEvent(`wait:${key}:${s.id}`, {
        event: CONTACT_REPLY, timeout: new Date(deadline), if: matchContact(resource.contactId),
      });
      if (reply) {
        await note(s, 'skipped_reply', 'contact replied while waiting; remaining steps stopped');
        break;
      }
    }
    if (deps.reload && !await stillCurrent(step, deps, caseId, version, key, s)) {
      await note(s, 'skipped_disabled', 'the plan changed while this run was waiting; remaining steps stopped');
      break;
    }
    const outcome = await step.run(`exec:${key}:${s.id}`, () => runStep(caseId, resource, s, deps));
    await note(s, outcome.status, outcome.detail);
  }
  return out;
}

/** True while the stored plan is still the approved version this run started from and the step is still switched on. */
async function stillCurrent(step: WorkflowStep, deps: PlanExecDeps, caseId: string, version: number, key: string, s: PlanStep): Promise<boolean> {
  const current = await step.run(`recheck:${key}:${s.id}`, async () => {
    const latest = await deps.reload!(caseId);
    return isExecutable(latest) && latest.version === version
      && !!latest.resources.find(r => r.resourceKey === key)?.steps.find(x => x.id === s.id && x.enabled);
  });
  return current;
}

async function replied(step: WorkflowStep, key: string, s: PlanStep, contactId: string, deps: PlanExecDeps): Promise<boolean> {
  return step.run(`reply-check:${key}:${s.id}`, () => deps.hasReply(contactId));
}

async function runStep(
  caseId: string, resource: ResourcePlan, s: PlanStep, deps: PlanExecDeps,
): Promise<{ status: StepStatus; detail?: string }> {
  try {
    if (s.purpose === 'verify') return await runVerify(caseId, resource, s, deps);
    if (s.channel === 'web_form') return await runWebForm(caseId, resource, s, deps);
    if (!resource.contactId) return { status: 'blocked', detail: 'no contact row; the patient must select this resource first' };
    return await deps.dispatchGated({ caseId, contactId: resource.contactId, resource, step: s });
  } catch (err) {
    // Detail is kept generic: never persist provider bodies or addresses.
    return { status: 'error', detail: err instanceof Error ? err.name : 'unknown error' };
  }
}

/** A verify step never dials: it only (re)uses an awaiting-approval request; the patient approves the call itself. */
async function runVerify(caseId: string, resource: ResourcePlan, s: PlanStep, deps: PlanExecDeps): Promise<{ status: StepStatus; detail?: string }> {
  if (s.channel !== 'voice' || !deps.createVerification) return { status: 'not_available', detail: 'verification calls are not available here' };
  try {
    await deps.createVerification({ caseId, resourceKey: resource.resourceKey });
    return { status: 'awaiting_approval', detail: 'verification call prepared; it waits for the patient to approve it' };
  } catch {
    return { status: 'blocked', detail: 'verification call could not be prepared' };
  }
}

async function runWebForm(caseId: string, resource: ResourcePlan, s: PlanStep, deps: PlanExecDeps) {
  // draftFill is idempotent per case + contact + url, so the approval-time drafting and this run never duplicate.
  const fill = await deps.webForm.draftFill({ caseId, contactId: resource.contactId, url: s.targetRef, resourceKey: resource.resourceKey });
  if (!fill.ok) return { status: 'not_available' as const, detail: fill.reason };
  if (fill.draft.status === 'submitted') return { status: 'submitted' as const };
  // Submitting needs a GatedDraft from checkOutbound, minted only when the patient approves the reviewed application.
  return { status: 'awaiting_approval' as const, detail: 'application drafted; submission waits for the patient to review and approve it' };
}
