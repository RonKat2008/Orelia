/** Synthetic fixtures only (example.org, 555 numbers, fictional insurer). */
import { contactPointEvidence } from '@/lib/contact-finder/contact-points';
import type { PlanEvidence } from '@/lib/plan/contract';

export const RECORD = Object.freeze({
  diseaseName: 'Example rare sarcoma',
  diseaseCodes: { orpha: 'ORPHA:000000' },
  subtype: 'hepatic primary',
  stageSummary: 'multifocal lesions',
  homeCity: 'Springfield',
  homeState: 'Vermont',
  insurer: 'Fictional Health Plan',
  planId: 'FHP-0042',
  travelLimitMiles: 250,
  goals: ['second_opinion', 'treatment', 'trial', 'support', 'aid'],
});

export const PHONE = '+16175550111';

export function phoneEvidence(origin: 'referral_coordinator' | 'new_patient_line' = 'referral_coordinator', address = PHONE): PlanEvidence {
  const e = contactPointEvidence({ channel: 'voice', address, origin, sourceUrl: 'https://center.example.org/contact', sourceKind: 'exa' }, '2026-10-01T00:00:00.000Z');
  if (!e?.id) throw new Error('fixture rejected');
  return { id: e.id, claimType: e.claimType, claim: e.claim, sourceUrl: e.sourceUrl, sourceKind: e.sourceKind };
}
