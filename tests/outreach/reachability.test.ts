import { describe, expect, it } from 'vitest';
import { contactRoutesOf, isReachable, isWebFormOnly, reachabilityLabel } from '../../lib/outreach/reachability';

const email = { id: 'e1', claimType: 'contact_point.email.new_patient_line', claim: 'intake@example.com', sourceUrl: 'https://example.com/intake', sourceKind: 'exa' as const };
const phone = { id: 'p1', claimType: 'contact_point.voice.nppes_location_phone', claim: '+16176323000', sourceUrl: 'https://npiregistry.cms.hhs.gov/provider-view/1', sourceKind: 'nppes' as const };
const form = { id: 'f1', claimType: 'contact_point.web_form.intake_form', claim: 'https://example.com/intake-form', sourceUrl: 'https://example.com/program', sourceKind: 'exa' as const };
const programPage = { id: 'w1', claimType: 'program_page', claim: 'https://example.com/program', sourceUrl: 'https://example.com/program', sourceKind: 'exa' as const };
const modelClaim = { id: 'm1', claimType: 'summary', claim: 'Call us at +16176323000 or email a@example.com', sourceUrl: 'https://example.com', sourceKind: 'exa' as const };

describe('reachability', () => {
  it('treats a program page and free-text claims as not reachable', () => {
    expect(isReachable([programPage, modelClaim])).toBe(false);
    expect(reachabilityLabel([programPage])).toBeNull();
  });
  it('reads email, phone, and online forms from contact_point rows', () => {
    expect(contactRoutesOf([email, phone, form]).map(r => r.channel)).toEqual(['email', 'voice', 'web_form']);
  });
  it('labels the best route: email, then phone, then online form', () => {
    expect(reachabilityLabel([form, phone, email])).toBe('Email found');
    expect(reachabilityLabel([form, phone])).toBe('Phone found');
    expect(reachabilityLabel([form])).toBe('Online intake form found');
  });
  it('flags web-form-only resources', () => {
    expect(isWebFormOnly([form])).toBe(true);
    expect(isWebFormOnly([form, email])).toBe(false);
    expect(isWebFormOnly([])).toBe(false);
  });
  it('accepts rows without an id', () => {
    const noId = { claimType: email.claimType, claim: email.claim, sourceUrl: email.sourceUrl, sourceKind: email.sourceKind };
    expect(isReachable([noId])).toBe(true);
  });
});
