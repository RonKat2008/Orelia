import { describe, expect, it } from 'vitest';
import { contactPlanLine } from '@/components/plan/model';
import { makePlan, step } from '../plan/plan-fixture';

const approved = makePlan('c', {
  status: 'approved', approvedAt: '2026-10-24T13:00:00.000Z',
  resources: [{
    resourceKey: 'expert:e1', targetKind: 'expert', targetId: 'e1', name: 'Dr X', contactId: 'contact-e1', rule: 'expert_referral', unavailableReason: null,
    steps: [
      step('s1', 1),
      step('s2', 2, { channel: 'voice', purpose: 'follow_up', waitFor: 'business_days:3' }),
      step('s3', 3, { enabled: false }),
    ],
  }],
});

describe('contactPlanLine', () => {
  it('returns null without a plan or a matching resource', () => {
    expect(contactPlanLine(null, { contactId: 'contact-e1', state: 'drafted' })).toBeNull();
    expect(contactPlanLine(approved, { contactId: 'nobody', state: 'drafted' })).toBeNull();
  });

  it('drafted contact is on step 1 and next is the follow-up with its wait', () => {
    const line = contactPlanLine(approved, { contactId: 'contact-e1', state: 'drafted' })!;
    expect(line.current).toBe('Step 1 of 2: Introduce by email');
    expect(line.next).toBe('Next: Follow up by phone call, after 3 business days');
  });

  it('advances by the number of outbound messages sent', () => {
    const line = contactPlanLine(approved, { contactId: 'contact-e1', state: 'sent', sentCount: 2 })!;
    expect(line.current).toBe('Step 2 of 2: Follow up by phone call');
    expect(line.next).toBe('Last step');
  });

  it('treats any state past drafted as one message sent when no count is known', () => {
    expect(contactPlanLine(approved, { contactId: 'contact-e1', state: 'replied' })!.current).toBe('Step 1 of 2: Introduce by email');
  });

  it('says the plan is not approved when it is a draft', () => {
    const draft = { ...approved, status: 'draft' as const, approvedAt: null };
    const line = contactPlanLine(draft, { contactId: 'contact-e1', state: 'drafted' })!;
    expect(line.current).toBe('Step 1 of 2: Introduce by email');
    expect(line.next).toBe('Plan not approved yet');
  });

  it('has no next step once the contact is finished', () => {
    expect(contactPlanLine(approved, { contactId: 'contact-e1', state: 'declined' })!.next).toBe('Last step');
  });

  it('names the date of the next step when the workflow has scheduled it', () => {
    const line = contactPlanLine(approved, { contactId: 'contact-e1', state: 'sent', nextAt: '2026-10-29T15:00:00.000Z' })!;
    expect(line.next).toBe('Next: Follow up by phone call, after 3 business days (due Thu, Oct 29)');
    expect(contactPlanLine(approved, { contactId: 'contact-e1', state: 'sent', nextAt: 'not a date' })!.next)
      .toBe('Next: Follow up by phone call, after 3 business days');
  });
});
