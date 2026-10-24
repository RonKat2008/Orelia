import { describe, expect, it } from 'vitest';
import { parseClassification } from '../../lib/inbox/classifier';

describe('phone grounding (never invent a number)', () => {
  it('drops a phone whose digits only appear by concatenating unrelated numbers in the reply', () => {
    const body = 'We received your note on 10/24/2026 at our 94110 office. Please call us to schedule.';
    const out = parseClassification({ class: 'call_to_schedule', confidence: 0.9, rationale: 'Asked to call.', phone: '(102) 420-2694' }, body);
    expect(out.phone).toBeUndefined();
  });
  it('drops an invented redirect phone built from an MRN and a zip code', () => {
    const body = 'Patient MRN 5550 noted. Please contact Dr. Patel at our 123456 location.';
    const out = parseClassification({ class: 'redirect', confidence: 0.9, rationale: 'Redirect.', redirect: { name: 'Dr. Patel', phone: '555-012-3456' } }, body);
    expect(out.redirect?.phone).toBeUndefined();
  });
});
