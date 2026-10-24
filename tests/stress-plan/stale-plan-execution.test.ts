/* eslint-disable @typescript-eslint/no-explicit-any -- loose fake WorkflowStep */
import { describe, expect, it, vi } from 'vitest';
import { createPlanExecutionWorkflow } from '@/lib/workflows/plan-workflow';
import { UnavailableWebFormChannel } from '@/lib/plan/channels';
import { MemoryPlanStore } from '@/lib/plan/store';
import { applyPlanEdits } from '@/lib/plan/edits';
import type { PlanExecDeps } from '@/lib/plan/execute';
import type { WorkflowStep } from '@/lib/workflows/engine';
import { makePlan, step } from '../plan/plan-fixture';

/** A step runner whose business-day wait lets the test change the stored plan "while waiting". */
class WaitingStep implements WorkflowStep {
  constructor(private onWait: () => Promise<void>) {}
  async run<T>(_id: string, fn: () => T | Promise<T>): Promise<T> { const v = await fn(); return (v === undefined ? v : JSON.parse(JSON.stringify(v))) as T; }
  async waitForEvent<E>(): Promise<E | null> { await this.onWait(); return null; }
  async sendEvent() { return undefined; }
}

describe('plan workflow: patient changes during a business-day wait', () => {
  it('does not run a step the patient turned off (or a plan rebuilt to draft) while the workflow was waiting', async () => {
    const store = new MemoryPlanStore();
    const plan = makePlan('case-1', {
      status: 'approved', approvedAt: '2026-10-24T13:00:00.000Z',
      resources: [{
        resourceKey: 'expert:e1', targetKind: 'expert', targetId: 'e1', name: 'E', contactId: 'contact-e1', rule: 'r', unavailableReason: null,
        steps: [step('s1', 1), step('s2', 2, { purpose: 'confirm', waitFor: 'business_days:3' })],
      }],
    });
    await store.save(plan);
    const dispatchGated = vi.fn(async () => ({ status: 'awaiting_approval' as const }));
    const deps: PlanExecDeps = {
      clock: { now: () => new Date('2026-10-26T15:00:00Z'), scale: 1 },
      dispatchGated, hasReply: async () => false, webForm: new UnavailableWebFormChannel(), record: async () => undefined,
    };
    // While waiting, the patient turns s2 off (PATCH -> new version, plan back to draft).
    const step2 = new WaitingStep(async () => {
      const current = (await store.latest('case-1'))!;
      const edited = applyPlanEdits(current, [{ type: 'toggle', resourceKey: 'expert:e1', stepId: 's2', enabled: false }], new Date('2026-10-27T10:00:00Z'));
      if (!edited.ok) throw new Error(edited.error);
      await store.save(edited.plan, current.version);
    });
    const wf = createPlanExecutionWorkflow(deps, () => store);
    await wf.handler({ event: { name: 'plan/approved', data: { caseId: 'case-1', version: 1 } }, step: step2 } as any);
    const ranSteps = (dispatchGated.mock.calls as any[]).map(c => c[0].step.id);
    expect(ranSteps).toEqual(['s1']); // BUG: ['s1', 's2'] -- the stale snapshot keeps executing
  });
});
