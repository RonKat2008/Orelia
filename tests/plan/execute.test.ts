/* eslint-disable @typescript-eslint/no-explicit-any -- FakeStep mirrors loosely typed engine payloads */
import { describe, expect, it, vi } from 'vitest';
import { executableSteps, executePlan, isExecutable, type PlanExecDeps, type StepOutcome } from '@/lib/plan/execute';
import { UnavailableWebFormChannel, type WebFormChannel } from '@/lib/plan/channels';
import { MAX_PLAN_RESOURCES, type ContactPlan, type ResourcePlan } from '@/lib/plan/contract';
import { createPlanExecutionWorkflow } from '@/lib/workflows/plan-workflow';
import { CONTACT_REPLY, type WorkflowStep } from '@/lib/workflows/engine';
import { MemoryPlanStore } from '@/lib/plan/store';
import { makePlan, step } from './plan-fixture';

const APPROVED = '2026-10-24T13:00:00.000Z';
const approved = (extra: Partial<ContactPlan> = {}) => makePlan('case-1', { status: 'approved', approvedAt: APPROVED, ...extra });

class FakeStep implements WorkflowStep {
  ids = new Set<string>();
  waits: { id: string; opts: any }[] = [];
  constructor(private replyAt: string[] = []) {}
  async run<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    if (this.ids.has(id)) throw new Error(`duplicate step id: ${id}`);
    this.ids.add(id);
    const v = await fn();
    return (v === undefined ? v : JSON.parse(JSON.stringify(v))) as T;
  }
  async waitForEvent<E>(id: string, opts: any): Promise<E | null> {
    if (this.ids.has(id)) throw new Error(`duplicate step id: ${id}`);
    this.ids.add(id);
    this.waits.push({ id, opts });
    return (this.replyAt.includes(id) ? { name: CONTACT_REPLY, data: {} } : null) as E | null;
  }
  async sendEvent() { return undefined; }
}

function makeDeps(over: Partial<PlanExecDeps> = {}) {
  const recorded: StepOutcome[] = [];
  const deps: PlanExecDeps = {
    clock: { now: () => new Date('2026-03-02T15:00:00Z'), scale: 1 },
    dispatchGated: vi.fn(async () => ({ status: 'awaiting_approval' as const })),
    hasReply: vi.fn(async () => false),
    webForm: new UnavailableWebFormChannel(),
    record: async o => { recorded.push(o); },
    ...over,
  };
  return { deps, recorded };
}

const resource = (key: string, steps: ResourcePlan['steps'], contactId: string | null = `contact-${key}`): ResourcePlan => ({
  resourceKey: `expert:${key}`, targetKind: 'expert', targetId: key, name: key, contactId, rule: 'r', unavailableReason: null, steps,
});

describe('executableSteps / isExecutable', () => {
  it('never executes a draft plan, or an approved status without approvedAt', () => {
    expect(isExecutable(makePlan('c'))).toBe(false);
    expect(isExecutable(makePlan('c', { status: 'approved', approvedAt: null }))).toBe(false);
    expect(executableSteps(makePlan('c'))).toEqual([]);
    expect(executableSteps(makePlan('c', { status: 'approved', approvedAt: null }))).toEqual([]);
    expect(isExecutable(null)).toBe(false);
  });

  it('returns ordered enabled steps and caps resources at 5', () => {
    const plan = approved({
      resources: Array.from({ length: 7 }, (_, i) => resource(`r${i}`, [step('b', 2), step('a', 1), step('c', 3, { enabled: false })])),
    });
    const out = executableSteps(plan);
    expect(out).toHaveLength(MAX_PLAN_RESOURCES);
    expect(out[0].steps.map(s => s.id)).toEqual(['a', 'b']);
  });
});

describe('executePlan', () => {
  it('draft plan runs nothing', async () => {
    const { deps, recorded } = makeDeps();
    expect(await executePlan(new FakeStep(), makePlan('case-1'), deps)).toEqual([]);
    expect(deps.dispatchGated).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('runs steps in order via the gated dispatcher and waits business days before a follow-up', async () => {
    const calls: string[] = [];
    const { deps, recorded } = makeDeps({ dispatchGated: vi.fn(async ({ step: s }) => { calls.push(s.id); return { status: 'awaiting_approval' as const }; }) });
    const fake = new FakeStep();
    const out = await executePlan(fake, approved(), deps);
    expect(calls).toEqual(['s1', 's2']);
    expect(out.map(o => o.status)).toEqual(['awaiting_approval', 'awaiting_approval']);
    expect(recorded).toHaveLength(2);
    expect(fake.waits).toHaveLength(1);
    expect(fake.waits[0].opts).toMatchObject({ event: CONTACT_REPLY, if: 'async.data.contactId == "contact-e1"' });
    // 3 business days after Mon 2026-03-02 15:00Z -> Thu 2026-03-05
    expect(new Date(fake.waits[0].opts.timeout).toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  it('skips disabled steps (recorded) and does not dispatch them', async () => {
    const plan = approved({ resources: [resource('e1', [step('s1', 1), step('s2', 2, { enabled: false })])] });
    const { deps } = makeDeps();
    const out = await executePlan(new FakeStep(), plan, deps);
    expect(out.map(o => [o.stepId, o.status])).toEqual([['s2', 'skipped_disabled'], ['s1', 'awaiting_approval']]);
    expect(deps.dispatchGated).toHaveBeenCalledTimes(1);
  });

  it('a reply during the wait stops remaining steps', async () => {
    const { deps } = makeDeps();
    const out = await executePlan(new FakeStep(['wait:expert:e1:s2']), approved(), deps);
    expect(out.map(o => [o.stepId, o.status])).toEqual([['s1', 'awaiting_approval'], ['s2', 'skipped_reply']]);
    expect(deps.dispatchGated).toHaveBeenCalledTimes(1);
  });

  it('an existing reply stops before the next step is dispatched', async () => {
    let n = 0;
    const { deps } = makeDeps({ hasReply: vi.fn(async () => ++n > 1) });
    const out = await executePlan(new FakeStep(), approved(), deps);
    expect(out.map(o => o.status)).toEqual(['awaiting_approval', 'skipped_reply']);
  });

  it('waitFor "reply" runs only when no reply has arrived and does not wait', async () => {
    const plan = approved({ resources: [resource('e1', [step('s1', 1, { waitFor: 'reply' })])] });
    const fake = new FakeStep();
    const { deps } = makeDeps();
    await executePlan(fake, plan, deps);
    expect(fake.waits).toEqual([]);
    expect(deps.dispatchGated).toHaveBeenCalledTimes(1);
  });

  it('email/voice with no contact row are blocked, never sent', async () => {
    const plan = approved({ resources: [resource('e1', [step('s1', 1), step('s2', 2, { channel: 'voice' })], null)] });
    const { deps } = makeDeps();
    const out = await executePlan(new FakeStep(), plan, deps);
    expect(out.map(o => o.status)).toEqual(['blocked', 'blocked']);
    expect(deps.dispatchGated).not.toHaveBeenCalled();
  });

  it('dispatcher errors become a generic error outcome and the next step continues', async () => {
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new TypeError('provider body with secret'))
      .mockResolvedValueOnce({ status: 'sent' });
    const plan = approved({ resources: [resource('e1', [step('s1', 1), step('s2', 2)])] });
    const { deps } = makeDeps({ dispatchGated: dispatch });
    const out = await executePlan(new FakeStep(), plan, deps);
    expect(out.map(o => o.status)).toEqual(['error', 'sent']);
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('web_form falls back to not_available, records it, and the next step continues', async () => {
    const plan = approved({ resources: [resource('e1', [step('s1', 1, { channel: 'web_form', targetRef: 'https://example.org/apply' }), step('s2', 2)])] });
    const { deps, recorded } = makeDeps();
    const out = await executePlan(new FakeStep(), plan, deps);
    expect(out.map(o => [o.channel, o.status])).toEqual([['web_form', 'not_available'], ['email', 'awaiting_approval']]);
    expect(recorded).toHaveLength(2);
  });

  it('web_form drafts the application (idempotently) and never submits; a submitted application reports submitted', async () => {
    const submit = vi.fn(async () => ({ ok: true as const, status: 'submitted' as const }));
    let status: 'draft' | 'submitted' = 'draft';
    const draftFill = vi.fn(async ({ url }: { url: string }) => ({ ok: true as const, draft: { applicationId: 'app-1', url, status, missingCount: 2 } }));
    const webForm: WebFormChannel = { probeForm: async () => ({ ok: false, status: 'not_available', reason: 'unused' }), draftFill, submitGated: submit };
    const plan = approved({ resources: [resource('e1', [step('s1', 1, { channel: 'web_form', targetRef: 'https://example.org/apply' })])] });
    const first = (await executePlan(new FakeStep(), plan, makeDeps({ webForm }).deps))[0];
    expect(first).toMatchObject({ status: 'awaiting_approval' });
    expect(first.detail).toMatch(/review/i);
    expect(draftFill).toHaveBeenCalledWith({ caseId: 'case-1', contactId: 'contact-e1', url: 'https://example.org/apply' });
    status = 'submitted';
    expect((await executePlan(new FakeStep(), plan, makeDeps({ webForm }).deps))[0].status).toBe('submitted');
    expect(submit).not.toHaveBeenCalled();
  });

  it('resources run independently of each other', async () => {
    const plan = approved({ resources: [resource('a', [step('s1', 1)]), resource('b', [step('s1', 1)])] });
    const { deps } = makeDeps();
    const out = await executePlan(new FakeStep(), plan, deps);
    expect(out.map(o => o.resourceKey).sort()).toEqual(['expert:a', 'expert:b']);
  });
});

describe('plan execution workflow', () => {
  it('re-reads the plan from the store and ignores unapproved plans', async () => {
    const store = new MemoryPlanStore();
    await store.save(makePlan('case-1'));
    const { deps } = makeDeps();
    const wf = createPlanExecutionWorkflow(deps, () => store);
    expect(await wf.handler({ event: { name: 'plan/approved', data: { caseId: 'case-1' } }, step: new FakeStep() })).toEqual({ outcome: 'not_approved' });
    expect(deps.dispatchGated).not.toHaveBeenCalled();
    await expect(wf.handler({ event: { name: 'plan/approved', data: {} }, step: new FakeStep() })).rejects.toThrow(/caseId/);
  });

  it('executes an approved stored plan', async () => {
    const store = new MemoryPlanStore();
    await store.save(approved());
    const { deps } = makeDeps();
    const wf = createPlanExecutionWorkflow(deps, () => store);
    expect(await wf.handler({ event: { name: 'plan/approved', data: { caseId: 'case-1' } }, step: new FakeStep() })).toEqual({ outcome: 'executed', steps: 2 });
  });
});
