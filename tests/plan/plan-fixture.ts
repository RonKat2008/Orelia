import type { ContactPlan, PlanStep } from '@/lib/plan/contract';

const T = '2026-10-24T12:00:00.000Z';
export const step = (id: string, order: number, extra: Partial<PlanStep> = {}): PlanStep => ({
  id, order, channel: 'email', purpose: 'intro', targetRef: 'ev-1', reason: 'Synthetic reason.',
  evidenceIds: ['ev-1'], waitFor: 'none', enabled: true, ...extra,
});

export function makePlan(caseId: string, extra: Partial<ContactPlan> = {}): ContactPlan {
  return {
    caseId, version: 1, status: 'draft', source: 'rules', summary: '1 resource: 2 steps.',
    resources: [{
      resourceKey: 'expert:e1', targetKind: 'expert', targetId: 'e1', name: 'Synthetic Expert', contactId: 'contact-e1',
      rule: 'expert_referral', unavailableReason: null,
      steps: [step('s1', 1), step('s2', 2, { purpose: 'follow_up', waitFor: 'business_days:3' })],
    }],
    createdAt: T, updatedAt: T, approvedAt: null, ...extra,
  };
}
