/**
 * Inngest-facing hook for contact-plan execution (plan/approved). The event payload is NOT trusted: the plan and
 * its approval are re-read from the PlanStore, and a draft or unapproved plan executes nothing. Sends are never made
 * here; email/voice steps delegate to the existing outbox approval path (see lib/plan/execute.ts).
 */
import { getPlanStore } from '../plan/store';
import { getWebFormChannel } from '../plan/channels';
import { executePlan, isExecutable, type PlanExecDeps, type StepOutcome } from '../plan/execute';
import type { ContactPlan, PlanStore } from '../plan/contract';
import { PLAN_APPROVED, type FunctionDefinition } from './engine';
import type { ConnectionDeps } from './connection-workflow';

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
      const outcomes: StepOutcome[] = await executePlan(step, plan, deps);
      return { outcome: 'executed', steps: outcomes.length };
    },
  };
}

/** Safe defaults: nothing is sent. Email/voice report awaiting_approval (or already_sent when the outbox sent it). */
export function createDefaultPlanExecDeps(conn: ConnectionDeps): PlanExecDeps {
  return {
    clock: conn.clock,
    ...(conn.tz ? { tz: conn.tz } : {}),
    webForm: getWebFormChannel(),
    async hasReply(contactId) {
      return STOP_STATES.has((await conn.loadContext(contactId)).state);
    },
    async dispatchGated({ contactId, step }) {
      const ctx = await conn.loadContext(contactId);
      if (ctx.state === 'sent' && (step.purpose === 'intro' || step.purpose === 'apply')) {
        return { status: 'already_sent', detail: 'the approved first message was already sent via the outbox' };
      }
      return { status: 'awaiting_approval', detail: 'requires an approved outbox message' };
    },
    async record(o) {
      console.info(`[plan-exec] ${o.resourceKey}/${o.stepId} ${o.channel} -> ${o.status}`);
    },
  };
}
