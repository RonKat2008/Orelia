import { describe, expect, it } from 'vitest';
import { applyPlanEdits, buildDeterministicPlan } from '@/lib/plan';
import type { ContactPlan } from '@/lib/plan/contract';
import { emailEv, NOW, phoneEv, plainEv, resource } from './planner-fixtures';

const LATER = new Date('2026-10-25T09:00:00.000Z');
const plan = buildDeterministicPlan('case-1', [
  resource('expert', 'e1', [emailEv('referral_coordinator', 'referrals@c.example.org'), phoneEv('referral_coordinator', '+16175550111')]),
  resource('trial', 't1', [plainEv('x')]),
], { now: NOW });

const ok = (r: ReturnType<typeof applyPlanEdits>): ContactPlan => {
  if (!r.ok) throw new Error(r.error);
  return r.plan;
};

describe('applyPlanEdits', () => {
  it('toggle disables a step, bumps version, keeps draft and does not mutate input', () => {
    const before = structuredClone(plan);
    const out = ok(applyPlanEdits(plan, [{ type: 'toggle', resourceKey: 'expert:e1', stepId: 's2', enabled: false }], LATER));
    expect(out.resources[0].steps[1].enabled).toBe(false);
    expect(out).toMatchObject({ version: 2, status: 'draft', approvedAt: null, updatedAt: LATER.toISOString(), createdAt: plan.createdAt });
    expect(out.summary).toBe('2 resources: 1 email. 1 has no contact channel yet.');
    expect(plan).toEqual(before);
  });

  it('reorder applies a permutation and renumbers orders', () => {
    const out = ok(applyPlanEdits(plan, [{ type: 'reorder', resourceKey: 'expert:e1', stepIds: ['s2', 's1'] }], LATER));
    expect(out.resources[0].steps.map(s => [s.id, s.order])).toEqual([['s2', 1], ['s1', 2]]);
  });

  it.each([
    [['s1']],
    [['s1', 's1']],
    [['s1', 's3']],
  ])('reorder rejects a non-permutation %j', stepIds => {
    expect(applyPlanEdits(plan, [{ type: 'reorder', resourceKey: 'expert:e1', stepIds }], LATER)).toMatchObject({ ok: false });
  });

  it('rejects unknown resourceKey and stepId', () => {
    expect(applyPlanEdits(plan, [{ type: 'toggle', resourceKey: 'expert:nope', stepId: 's1', enabled: false }], LATER))
      .toEqual({ ok: false, error: expect.stringMatching(/unknown resource/i) });
    expect(applyPlanEdits(plan, [{ type: 'toggle', resourceKey: 'expert:e1', stepId: 's9', enabled: false }], LATER))
      .toEqual({ ok: false, error: expect.stringMatching(/unknown step/i) });
  });

  it('approve sets status and approvedAt', () => {
    const out = ok(applyPlanEdits(plan, [{ type: 'approve' }], LATER));
    expect(out).toMatchObject({ status: 'approved', approvedAt: LATER.toISOString(), version: 2 });
  });

  it('editing an approved plan sends it back to draft', () => {
    const approved = ok(applyPlanEdits(plan, [{ type: 'approve' }], LATER));
    const out = ok(applyPlanEdits(approved, [{ type: 'toggle', resourceKey: 'expert:e1', stepId: 's1', enabled: false }], LATER));
    expect(out).toMatchObject({ status: 'draft', approvedAt: null, version: 3 });
  });

  it('edits apply in order: toggle then approve in one batch is approved', () => {
    const out = ok(applyPlanEdits(plan, [{ type: 'toggle', resourceKey: 'expert:e1', stepId: 's2', enabled: false }, { type: 'approve' }], LATER));
    expect(out.status).toBe('approved');
  });

  it('approve is rejected when no step is enabled anywhere', () => {
    const r = applyPlanEdits(plan, [
      { type: 'toggle', resourceKey: 'expert:e1', stepId: 's1', enabled: false },
      { type: 'toggle', resourceKey: 'expert:e1', stepId: 's2', enabled: false },
      { type: 'approve' },
    ], LATER);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/at least one/i) });
  });

  it('rejects an empty edit list', () => {
    expect(applyPlanEdits(plan, [], LATER)).toMatchObject({ ok: false });
  });
});
