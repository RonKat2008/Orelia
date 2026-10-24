import { describe, expect, it } from 'vitest';
import { normalizeAddress, parseAllowlist, isAllowed } from '../../lib/safety/allowlist';
import { canFollowUp } from '../../lib/safety/caps';
import { containsUnsharedField, minimize } from '../../lib/safety/minimize';
import { checkOutbound, type OutboundInput } from '../../lib/safety/outbound-gate';
import { AI_DISCLOSURE_EMAIL } from '../../lib/safety/disclosure';

const input = (): OutboundInput => ({
  draft: { channel: 'email', address: 'desk@example.test', body: `Please coordinate intake.\n${AI_DISCLOSURE_EMAIL}`, approvedAt: '2026-10-20T12:00:00Z' },
  caseRecord: {}, consent: { sharedFields: [] }, contacts: [], allowlist: ['desk@example.test'], now: '2026-10-21T12:00:00Z', mode: 'demo',
});

describe('safety boundary cases', () => {
  it.each(['+0123456789', '+1234567', '+1234567890123456', '+1 extension 123', 'Name <desk@example.test>', 'desk@example.test,other@example.test'])('rejects malformed destination %s', address => {
    expect(normalizeAddress(address)).toBeNull();
    expect(isAllowed(address, [address])).toBe(false);
  });
  it('deduplicates normalized allowlist entries and preserves E.164 length boundaries', () => {
    expect(parseAllowlist('DESK@example.test, desk@example.test,+12 345 678,+12345678')).toEqual(['desk@example.test', '+12345678']);
    expect(normalizeAddress('+123456789012345')).toBe('+123456789012345');
  });
  it('rejects an invalid current time even with a valid follow-up anchor', () => {
    expect(canFollowUp('2026-10-20', 0, 'invalid')).toBe(false);
  });
  it('ignores empty and non-scalar private values but scans nested finite numbers', () => {
    const record = { empty: '  ', unset: undefined, bool: true, nil: null, invalid: Infinity, nested: [{ value: 73142 }] };
    expect(containsUnsharedField('Please coordinate intake.', record, [])).toBe(false);
    expect(containsUnsharedField('Reference: 73142.', record, [])).toBe(true);
    expect(containsUnsharedField('Reference: 73142.', record, ['nested'])).toBe(false);
  });
  it('copies selected nested fields without retaining mutable references', () => {
    const record = { goals: [{ text: 'intake' }], secret: 'hidden' };
    const result = minimize(record, ['goals']) as { goals: { text: string }[] };
    result.goals[0].text = 'changed';
    expect(record.goals[0].text).toBe('intake');
    expect(result).not.toHaveProperty('secret');
  });
  it('finds a private value after an occurrence embedded in a longer word', () => {
    expect(containsUnsharedField('chair; aid', { goal: 'aid' }, [])).toBe(true);
    expect(containsUnsharedField('aidful', { goal: 'aid' }, [])).toBe(false);
  });
  it.each([
    { id: 'c1', address: 'other@example.test', state: 'drafted' },
    { id: 'c1', address: 'desk@example.test', caseId: 'other-case', state: 'drafted' },
  ])('refuses an existing contact whose address or case does not match', contact => {
    const request = input();
    request.draft = { ...request.draft, contactId: 'c1', caseId: 'case1' };
    request.contacts = [contact];
    expect(checkOutbound(request)).toEqual({ ok: false, reasons: ['consent_mismatch'] });
  });
  it('requires cadence data when an explicit follow-up has no known contact', () => {
    const base = input();
    const request = { ...base, draft: { ...base.draft, isFollowUp: true } };
    expect(checkOutbound(request)).toEqual({ ok: false, reasons: ['follow_up_cadence'] });
  });
  it('refuses a sent contact with no follow-up counter', () => {
    const request = input();
    request.contacts = [{ address: request.draft.address, state: 'sent', lastSentAt: '2026-10-01' }];
    expect(checkOutbound(request)).toEqual({ ok: false, reasons: ['follow_up_cadence'] });
  });
});
