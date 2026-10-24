import { describe, expect, it } from 'vitest';
import { buildDeterministicPlan } from '@/lib/plan/rules';
import { emailEv, formEv, phoneEv, resource, NOW } from '../plan/planner-fixtures';

describe('rules: verified channels that are silently dropped', () => {
  // TODO: skipped - tests/plan/rules.test.ts ('form without email: just apply (phone is not used)') pins this as a deliberate
  // product rule for aid orgs; changing it is a product decision, not a bug fix.
  it.skip('financial aid with an online form AND a phone uses the phone as a follow-up (like every other family)', () => {
    const plan = buildDeterministicPlan('c', [resource('organization', 'o1', [formEv('application_form', 'https://aid.example.org/apply'), phoneEv('org_contact', '+16175550100')], 'financial_aid')], { now: NOW });
    // BUG: rule 'aid_form_only' -- the verified phone is never used (advocacy/trial/specialist get form_then_call).
    expect(plan.resources[0].steps.map(s => s.channel)).toEqual(['web_form', 'voice']);
  });

  it('a 6th selected resource is not dropped without telling the patient', () => {
    const inputs = Array.from({ length: 6 }, (_, i) => resource('expert', `e${i}`, [emailEv('org_contact', `info@clinic${i}.example.org`)]));
    const plan = buildDeterministicPlan('c', inputs, { now: NOW });
    // BUG: resources are sliced to 5 and the summary just says "5 resources: 5 emails." -- e5 vanishes silently.
    expect(plan.resources.length === 6 || /not included|only the first 5|left out/i.test(plan.summary)).toBe(true);
  });
});
