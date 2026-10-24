/** Best-effort `plan/approved` workflow event. The plan is already persisted as approved before this is called. */
import { PLAN_APPROVED } from '../workflows/engine';

export type PlanApprovedEmitter = (caseId: string, version: number) => Promise<void>;

async function defaultEmitter(caseId: string, version: number): Promise<void> {
  if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) return; // workflow engine not configured
  const { inngest } = await import('../workflows/inngest');
  await inngest.send({ name: PLAN_APPROVED, data: { caseId, version } });
}

let emitter: PlanApprovedEmitter = defaultEmitter;

/** Test helper: inject (or clear with undefined) the emitter. */
export function setPlanApprovedEmitterForTests(e: PlanApprovedEmitter | undefined): void {
  emitter = e ?? defaultEmitter;
}

/** A failed emit must not fail the patient's approval. */
export async function emitPlanApproved(caseId: string, version: number): Promise<void> {
  try {
    await emitter(caseId, version);
  } catch (err) {
    console.error('[plan] plan/approved event not emitted', err instanceof Error ? err.name : 'unknown');
  }
}
