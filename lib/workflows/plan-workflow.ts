/**
 * Inngest-facing hook for contact-plan execution (plan/approved). The event payload is NOT trusted: the plan and
 * its approval are re-read from the PlanStore, and a draft or unapproved plan executes nothing. Sends are never made
 * here; email/voice steps delegate to the existing outbox approval path (see lib/plan/execute.ts).
 */
import { getPlanStore } from '../plan/store';
import { getWebFormChannel } from '../plan/channels';
import { executePlan, isExecutable, isOrphanFollowUp, type PlanExecDeps, type StepOutcome } from '../plan/execute';
import type { ContactPlan, PlanStore } from '../plan/contract';
import { PLAN_APPROVED, type FunctionDefinition } from './engine';
import type { ConnectionDeps } from './connection-workflow';
import { defaultCreateDraft, defaultCreateVerification } from '../plan/materialize-wiring';

/** Contact states in which the contact has engaged or declined: remaining plan steps stop. */
const STOP_STATES = new Set(['replied', 'task_open', 'records_sent', 'appointment_booked', 'connected', 'declined']);

export function createPlanExecutionWorkflow(deps: PlanExecDeps, store: () => PlanStore = getPlanStore): FunctionDefinition {
  return {
    id: 'contact-plan-execution',
    trigger: { event: PLAN_APPROVED },
    idempotency: 'event.data.caseId + "-" + event.data.version',
    async handler({ event, step }) {
      const caseId = event.data?.caseId;
      if (typeof caseId !== 'string' || !caseId) throw new Error('plan/approved missing caseId');
      const plan = await step.run('load-plan', async (): Promise<ContactPlan | null> => {
        const latest = await store().latest(caseId);
        return isExecutable(latest) ? latest : null;
      });
      if (!plan) return { outcome: 'not_approved' };
      const outcomes: StepOutcome[] = await executePlan(step, plan, { ...deps, reload: id => store().latest(id) });
      return { outcome: 'executed', steps: outcomes.length };
    },
  };
}

export interface DefaultPlanExecOptions {
  /** The existing outreach draft path (idempotent: a pending draft is reused). Never sends. */
  createDraft?: (contactId: string) => Promise<{ id: string }>;
}

const reasonCode = (error: unknown): string => {
  const reasons = (error as { reasons?: unknown })?.reasons;
  return Array.isArray(reasons) && typeof reasons[0] === 'string' ? reasons[0] : 'draft_failed';
};

/**
 * Safe defaults: nothing is sent. A due email/voice step writes (or reuses) an UNAPPROVED outbox draft and reports
 * awaiting_approval; the patient's approval in the outbox is what sends it, through checkOutbound.
 */
export function createDefaultPlanExecDeps(conn: ConnectionDeps, opts: DefaultPlanExecOptions = {}): PlanExecDeps {
  const createDraft = opts.createDraft ?? defaultCreateDraft;
  return {
    clock: conn.clock,
    ...(conn.tz ? { tz: conn.tz } : {}),
    webForm: getWebFormChannel(),
    createVerification: defaultCreateVerification,
    async hasReply(contactId) {
      return STOP_STATES.has((await conn.loadContext(contactId)).state);
    },
    async dispatchGated({ contactId, step, resource }) {
      const ctx = await conn.loadContext(contactId);
      if (ctx.state === 'sent' && (step.purpose === 'intro' || step.purpose === 'apply')) {
        return { status: 'already_sent', detail: 'the approved first message was already sent via the outbox' };
      }
      if (step.purpose === 'follow_up' && !isOrphanFollowUp(resource, step)) return { status: 'awaiting_approval', detail: 'covered by the walk-away follow-up plan' };
      try {
        await createDraft(contactId);
        return { status: 'awaiting_approval', detail: 'outbox draft written; it waits for the patient to approve it' };
      } catch (error) {
        return { status: 'blocked', detail: reasonCode(error) };
      }
    },
    async record(o) {
      console.info(`[plan-exec] ${o.resourceKey}/${o.stepId} ${o.channel} -> ${o.status}`);
    },
  };
}
