import { describe, expect, it, vi } from 'vitest';
import { buildDeterministicPlan, refinePlan, ruleFamily } from '@/lib/plan';
import { contactPlanSchema, type ResourcePlan } from '@/lib/plan/contract';
import { emailEv, formEv, NOW, phoneEv, plainEv, resource } from '../planner-fixtures';

const E = () => emailEv('org_contact', 'info@registry.example.org');
const P = () => phoneEv('org_contact', '+16175550177');
const F = () => formEv('application_form', 'https://registry.example.org/join');
const registryTag = () => ({ id: 'reg-1', claimType: 'patient_registry', claim: 'Synthetic patient registry for a rare condition', sourceUrl: 'https://registry.example.org', sourceKind: 'exa' as const });

const only = (r: Parameters<typeof buildDeterministicPlan>[1][number]): ResourcePlan => buildDeterministicPlan('case-1', [r], { now: NOW }).resources[0];
const shape = (rp: ResourcePlan) => rp.steps.map(s => `${s.channel}:${s.purpose}:${s.waitFor}`);

describe('registry rule family', () => {
  it('organizationKind "registry" is its own family', () => {
    expect(ruleFamily({ targetKind: 'organization', subKind: 'registry' })).toBe('registry');
  });

  it('an organization with code-stamped patient_registry evidence is a registry even without a subKind', () => {
    expect(ruleFamily({ targetKind: 'organization', subKind: null, evidence: [registryTag()] })).toBe('registry');
  });

  it('a trial with patient_registry evidence still follows trial rules', () => {
    expect(ruleFamily({ targetKind: 'trial', subKind: null, evidence: [registryTag()] })).toBe('trial');
  });
});

describe('registry plan rules', () => {
  it('form + email: join through the online form, then confirm by email', () => {
    const r = only(resource('organization', 'r1', [P(), E(), F()], 'registry'));
    expect(r.rule).toBe('registry_form_then_email');
    expect(shape(r)).toEqual(['web_form:apply:none', 'email:confirm:business_days:3']);
    expect(r.steps[0].targetRef).toBe('https://registry.example.org/join');
  });

  it('form only: apply online; a phone is never used', () => {
    const r = only(resource('organization', 'r1', [P(), F()], 'registry'));
    expect(r.rule).toBe('registry_form_only');
    expect(shape(r)).toEqual(['web_form:apply:none']);
  });

  it('no form: email first, a call only as a follow-up', () => {
    const r = only(resource('organization', 'r1', [P(), E()], 'registry'));
    expect(r.rule).toBe('registry_email_then_call');
    expect(shape(r)).toEqual(['email:intro:none', 'voice:follow_up:business_days:3']);
  });

  it('email only', () => {
    const r = only(resource('organization', 'r1', [E()], 'registry'));
    expect(r.rule).toBe('registry_email_only');
    expect(shape(r)).toEqual(['email:intro:none']);
  });

  it('phone only: never a call first, so no steps and a plain reason', () => {
    const r = only(resource('organization', 'r1', [P()], 'registry'));
    expect(r.steps).toEqual([]);
    expect(r.rule).toBe('registry_no_online_channel');
    expect(r.unavailableReason).toMatch(/online form or by email/);
  });

  it('detected from evidence in memory mode (subKind null)', () => {
    const r = only(resource('organization', 'r1', [registryTag(), E(), F()], null));
    expect(r.rule).toBe('registry_form_then_email');
  });

  it('plans are schema-valid and steps have no verify call', () => {
    const plan = buildDeterministicPlan('case-1', [resource('organization', 'r1', [P(), E(), F()], 'registry')], { now: NOW });
    expect(contactPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.resources[0].steps.some(s => s.purpose === 'verify')).toBe(false);
  });
});

describe('observational studies follow trial rules', () => {
  const tE = emailEv('ctgov_central_contact', 'trials@sponsor.example.org', 'https://clinicaltrials.gov/study/NCT00000002');
  const tP = phoneEv('ctgov_central_contact', '+16175550133', 'https://clinicaltrials.gov/study/NCT00000002');
  const observational = { id: 'obs-1', claimType: 'observational_study', claim: 'Observational natural history study', sourceUrl: 'https://clinicaltrials.gov/study/NCT00000002', sourceKind: 'ctgov' as const };

  it('email then call after 2 business days, like any trial', () => {
    const r = only(resource('trial', 'NCT00000002', [observational, tE, tP]));
    expect(r.rule).toBe('trial_email_then_call');
    expect(shape(r)).toEqual(['email:intro:none', 'voice:follow_up:business_days:2']);
  });
});

describe('refinement keeps registries off a call-first plan', () => {
  it('rejects a proposal that puts a call first for a registry', async () => {
    const inputs = [resource('organization', 'r1', [E(), P(), plainEv('x')], 'registry')];
    const base = buildDeterministicPlan('case-1', inputs, { now: NOW });
    const complete = vi.fn(async (messages: { role: string; content: string }[]) => {
      const payload = JSON.parse(messages[messages.length - 1].content.split('\n').slice(1).join('\n')) as {
        resources: { resourceKey: string; family: string; contactPoints: { ref: string; channel: string }[] }[];
      };
      const res = payload.resources[0];
      expect(res.family).toBe('registry');
      const voice = res.contactPoints.find(c => c.channel === 'voice')!.ref;
      const email = res.contactPoints.find(c => c.channel === 'email')!.ref;
      return JSON.stringify({ resources: [{ resourceKey: 'organization:r1', steps: [
        { channel: 'voice', purpose: 'intro', targetRef: voice, waitFor: 'none', reason: 'A quick call first.', evidenceIds: [voice] },
        { channel: 'email', purpose: 'follow_up', targetRef: email, waitFor: 'business_days:3', reason: 'Then an email.', evidenceIds: [email] },
      ] }] });
    });
    expect(await refinePlan(base, inputs, { complete })).toEqual(base);
    expect(complete).toHaveBeenCalled();
  });
});
