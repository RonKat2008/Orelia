import { describe, expect, it } from 'vitest';
import { evidenceMetaFor, planEvidenceMeta } from '@/lib/plan/evidence-meta';
import { demoStepLabel, evidenceBadgeText } from '@/components/plan/model';
import { buildDeterministicPlan } from '@/lib/plan/rules';
import type { PlanResourceInput } from '@/lib/plan/contract';

describe('plan evidence badges', () => {
  it('labels a source by its site hostname, or by registry name', () => {
    expect(evidenceMetaFor('https://www.mayoclinic.org/appointments', 'exa')).toEqual({ host: 'mayoclinic.org', sourceKind: 'exa', label: 'mayoclinic.org' });
    expect(evidenceMetaFor('https://npiregistry.cms.hhs.gov/provider/1', 'nppes').label).toBe('NPI registry');
    expect(evidenceMetaFor('not a url', 'exa').label).toBe('Source page');
    expect(evidenceBadgeText('a99035f0-uuid', { label: 'mayoclinic.org' })).toBe('Source: mayoclinic.org');
    expect(evidenceBadgeText('x-a99035')).toBe('Source a99035');
  });

  it('maps every cited evidence id of a plan to its own resource row', () => {
    const inputs: PlanResourceInput[] = [{
      targetKind: 'trial', targetId: 'NCT1', name: 'Trial', contactId: 'c1',
      evidence: [{ id: 'e-phone', claimType: 'contact_point.voice.ctgov_central_contact', claim: '+15075550100', sourceUrl: 'https://clinicaltrials.gov/study/NCT1', sourceKind: 'ctgov' }],
    }];
    const plan = buildDeterministicPlan('case-1', inputs, { now: new Date('2026-10-24T12:00:00Z') });
    expect(planEvidenceMeta(plan, inputs)).toEqual({ 'e-phone': { host: 'clinicaltrials.gov', sourceKind: 'ctgov', label: 'ClinicalTrials.gov' } });
  });

  it('labels demo destinations honestly per channel', () => {
    expect(demoStepLabel('email', false)).toBe('Demo: delivered to Orelia test inbox');
    expect(demoStepLabel('web_form', false)).toBe('Demo: delivered to Orelia test form');
    expect(demoStepLabel('voice', false)).toMatch(/simulated/);
    expect(demoStepLabel('voice', true)).toMatch(/test phone/);
  });
});
