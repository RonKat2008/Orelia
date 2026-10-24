import { describe, expect, it } from 'vitest';
import { formatFieldValue, sameFieldValue } from '../../lib/safety/field-value';
import { checkOutbound } from '../../lib/safety/outbound-gate';
import { AI_DISCLOSURE_EMAIL } from '../../lib/safety/disclosure';

describe('formatFieldValue', () => {
  it('renders strings trimmed, numbers as text and lists as "a, b"', () => {
    expect(formatFieldValue('  Boston ')).toBe('Boston');
    expect(formatFieldValue(42)).toBe('42');
    expect(formatFieldValue(['second_opinion', ' trial ', 3])).toBe('second_opinion, trial, 3');
  });
  it('returns undefined for empty, non-finite and unsupported values', () => {
    for (const v of ['  ', [], [' '], NaN, null, undefined, { a: 1 }, true]) expect(formatFieldValue(v), String(v)).toBeUndefined();
  });
});

describe('sameFieldValue', () => {
  it('treats a list and its rendered text as the same value', () => {
    expect(sameFieldValue('a, b', ['a', 'b'])).toBe(true);
    expect(sameFieldValue('a,b', ['a', 'b'])).toBe(true);
  });
  it('ignores case and whitespace differences (select options) but not content', () => {
    expect(sameFieldValue('Massachusetts ', 'massachusetts')).toBe(true);
    expect(sameFieldValue('a, b', ['a', 'c'])).toBe(false);
    expect(sameFieldValue('a', ['a', 'b'])).toBe(false);
    expect(sameFieldValue('', [])).toBe(false);
  });
});

describe('web gate with list-valued consented fields', () => {
  it('accepts a ticked list field rendered as "a, b" by the form mapper', () => {
    const result = checkOutbound({
      draft: {
        channel: 'web_form', address: 'http://localhost:3000/apply', body: 'Application', approvedAt: '2026-10-28T15:00:00Z', caseId: 'case-1',
        webForm: {
          formFingerprint: 'fp', uploads: [], hasFreeText: true,
          fields: [
            { fieldKey: 'goals', label: 'Goals', type: 'text', value: formatFieldValue(['second opinion', 'clinical trial'])!, source: { kind: 'consent', key: 'goals' } },
            { fieldKey: 'notes', label: 'Notes', type: 'textarea', value: AI_DISCLOSURE_EMAIL, source: { kind: 'disclosure' } },
          ],
        },
      },
      consent: { sharedFields: ['goals'] },
      caseRecord: { goals: ['second opinion', 'clinical trial'] },
      contacts: [], allowlist: [], webAllowlist: ['localhost:3000'], now: '2026-10-28T16:00:00Z', mode: 'demo',
    });
    expect(result).toMatchObject({ ok: true });
  });
});
