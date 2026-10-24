import { describe, expect, it } from 'vitest';
import type { NppesProvider } from '@/lib/agents/research/source-ports';
import { assessNppes, pageShowsPatientCare } from '@/lib/experts/sees-patients';

const provider = (over: Partial<NppesProvider> = {}): NppesProvider => ({
  npi: '1234567890', firstName: 'Ada', lastName: 'Example', taxonomy: 'Medical Oncology', state: 'IL', city: 'Springfield',
  raw: { number: '1234567890', enumeration_type: 'NPI-1', basic: {}, taxonomies: [{ code: '207RX0202X', desc: 'Medical Oncology', primary: true }] } as never,
  ...over,
});

describe('assessNppes location anchor', () => {
  it('yes only when the practice state matches the paper-affiliation state', () => {
    expect(assessNppes([provider()], 'Ada', 'Example', { state: 'IL' }).kind).toBe('yes');
    expect(assessNppes([provider({ state: 'CA' })], 'Ada', 'Example', { state: 'IL' })).toEqual({ kind: 'unknown', reason: 'location_mismatch' });
  });
  it('a practice-location address state also counts', () => {
    const p = provider({ state: undefined, raw: { number: '1234567890', enumeration_type: 'NPI-1', basic: {}, addresses: [{ state: 'il', city: 'Springfield', address_purpose: 'LOCATION' }], taxonomies: [{ code: '207RX0202X', desc: 'Medical Oncology' }] } as never });
    expect(assessNppes([p], 'Ada', 'Example', { state: 'IL' }).kind).toBe('yes');
  });
  it('falls back to a city match only when the affiliation has no state; no anchor at all is unknown', () => {
    expect(assessNppes([provider()], 'Ada', 'Example', { city: 'springfield' }).kind).toBe('yes');
    expect(assessNppes([provider()], 'Ada', 'Example', { city: 'Boston' }).kind).toBe('unknown');
    expect(assessNppes([provider()], 'Ada', 'Example', {})).toEqual({ kind: 'unknown', reason: 'location_mismatch' });
  });
});

describe('pageShowsPatientCare whole-word names', () => {
  it('rejects substring name hits and accepts whole words', () => {
    expect(pageShowsPatientCare('Adam Examples sees new patients.', undefined, 'Ada', 'Example')).toBe(false);
    expect(pageShowsPatientCare('Dr. Ada Example sees new patients.', undefined, 'Ada', 'Example')).toBe(true);
    expect(pageShowsPatientCare('Dr. Zoë Müller: make an appointment', undefined, 'Zoe', 'Muller')).toBe(true);
  });
});
