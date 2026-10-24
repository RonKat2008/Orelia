import { describe, expect, it, vi } from 'vitest';
import { buildDeterministicPlan } from '@/lib/plan/rules';
import { applyPlanEdits } from '@/lib/plan/edits';
import { materializeApprovedPlan } from '@/lib/plan/materialize';
import { UnavailableWebFormChannel } from '@/lib/plan/channels';
import { emailEv, phoneEv, resource, NOW } from '../plan/planner-fixtures';

describe('plan edits: turning off the first email of an email-then-call resource', () => {
  it('approving a plan whose only enabled step is the follow-up call still reaches the resource', async () => {
    const plan = buildDeterministicPlan('case-1', [resource('trial', 't1', [emailEv('org_contact', 'info@aid.example.org'), phoneEv('org_contact', '+16175550100')])], { now: NOW });
    expect(plan.resources[0].rule).toBe('trial_email_then_call');
    // Patient prefers a call: turns the email off, keeps the call, approves. Approval is accepted.
    const edited = applyPlanEdits(plan, [
      { type: 'toggle', resourceKey: 'trial:t1', stepId: 's1', enabled: false },
      { type: 'approve' },
    ], NOW);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const createDraft = vi.fn(async () => ({ id: 'd1' }));
    const out = await materializeApprovedPlan(edited.plan, {
      contact: async id => ({ id, channel: 'voice' }), createDraft, webForm: new UnavailableWebFormChannel(),
    });
    // BUG: the call is treated as a 'follow_up_plan' step of a first message that will never be sent, so nothing is
    // drafted now and the walk-away follow-up plan never starts either: the resource is silently never contacted.
    expect(out.map(o => o.status)).not.toEqual(['follow_up_plan']);
    expect(createDraft).toHaveBeenCalled();
  });
});
