import { describe, expect, it } from 'vitest';
import { applicationStepContext, draftStepContext, stepContextText } from '@/components/plan/model';
import { makePlan, step } from '../plan/plan-fixture';

const plan = makePlan('case-1', {
  status: 'approved', approvedAt: '2026-10-24T13:00:00.000Z',
  resources: [{
    resourceKey: 'organization:o1', targetKind: 'organization', targetId: 'o1', name: 'Synthetic Aid Fund', contactId: 'contact-o1',
    rule: 'financial_aid_apply', unavailableReason: null,
    steps: [
      step('s1', 1, { channel: 'web_form', purpose: 'apply', targetRef: 'https://aid.example.org/apply' }),
      step('s2', 2, { purpose: 'confirm', waitFor: 'business_days:5' }),
      step('s3', 3, { enabled: false, channel: 'voice', purpose: 'follow_up' }),
    ],
  }],
});

describe('plan step context for outbox cards', () => {
  it('names the step of the resource an email draft belongs to, counting enabled steps only', () => {
    const ctx = draftStepContext(plan, { contactId: 'contact-o1', channel: 'email' });
    expect(ctx).toEqual({ resourceName: 'Synthetic Aid Fund', number: 2, total: 2, purpose: 'confirm', channel: 'email' });
    expect(stepContextText(ctx!)).toBe('Step 2 of 2 in the plan for Synthetic Aid Fund: Confirm by email');
  });

  it('matches an application to its web_form step by URL', () => {
    const ctx = applicationStepContext(plan, { contactId: 'contact-o1', url: 'https://aid.example.org/apply' });
    expect(stepContextText(ctx!)).toBe('Step 1 of 2 in the plan for Synthetic Aid Fund: Apply by online form');
  });

  it('returns null without a plan, for other contacts, or for disabled steps', () => {
    expect(draftStepContext(null, { contactId: 'contact-o1', channel: 'email' })).toBeNull();
    expect(draftStepContext(plan, { contactId: 'someone-else', channel: 'email' })).toBeNull();
    expect(draftStepContext(plan, { contactId: 'contact-o1', channel: 'voice' })).toBeNull();
    expect(applicationStepContext(plan, { contactId: null, url: 'https://other.example.org/' })).toBeNull();
  });
});
