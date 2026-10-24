import { describe, it, expect } from 'vitest';
import { checkOutbound, type OutboundInput } from '../../lib/safety/outbound-gate';
import { AI_DISCLOSURE_VOICE, withDisclosure } from '../../lib/safety/disclosure';
const now = '2026-10-28T16:00:00Z';
function valid(): OutboundInput {
  return {
    draft: { channel: 'email', address: 'test@example.com', body: withDisclosure('Please coordinate a rare disease second opinion.'), approvedAt: '2026-10-28T15:00:00Z' },
    consent: { sharedFields: ['diseaseName'] },
    caseRecord: { diseaseName: 'rare disease', insurer: 'Fictional Plan', planId: 'SECRET-123', stageSummary: 'Localized stage' },
    contacts: [], allowlist: ['test@example.com', '+12025550123'], now, mode: 'demo',
  };
}
function reasons(input: OutboundInput): string[] {
  const result = checkOutbound(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.reasons;
}
describe('OutboundGate', () => {
  it('returns an immutable gated payload for a fully valid draft', () => {
    const input = valid();
    const result = checkOutbound(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.address).toBe('test@example.com');
      expect(result.payload.sharedFields).toEqual(['diseaseName']);
      expect(result.payload.caseData).toEqual({ diseaseName: 'rare disease' });
      expect(Object.isFrozen(result.payload)).toBe(true);
      expect(Object.isFrozen(result.payload.caseData)).toBe(true);
    }
  });
  it('requires message approval even when consent is approved', () => {
    const input = valid(); input.draft = { ...input.draft, approvedAt: null }; input.consent = { ...input.consent, approvedAt: now };
    expect(reasons(input)).toEqual(['not_approved']);
  });
  it.each(['invalid', '2027-01-01'])('rejects invalid or future approval %s', approvedAt => {
    const input = valid(); input.draft = { ...input.draft, approvedAt };
    expect(reasons(input)).toContain('not_approved');
  });
  it.each(['dev', 'demo', 'prod'] as const)('requires allowlisting by default in %s', mode => {
    expect(reasons({ ...valid(), mode, allowlist: [] })).toEqual(['not_allowlisted']);
  });
  it('only permits the explicit production override', () => {
    expect(checkOutbound({ ...valid(), mode: 'prod', allowlist: [], outboundAllowReal: 'true' }).ok).toBe(true);
    expect(reasons({ ...valid(), mode: 'prod', allowlist: [], outboundAllowReal: 'TRUE' })).toContain('not_allowlisted');
    expect(reasons({ ...valid(), allowlist: [], outboundAllowReal: 'true' })).toContain('not_allowlisted');
  });
  it('caps a new contact but permits an existing active contact at capacity', () => {
    const input = valid(); input.contacts = Array.from({length: 5}, (_, i) => ({ id: String(i), address: i === 0 ? 'existing@example.com' : 'other@example.com', state: 'sent' }));
    expect(reasons(input)).toEqual(['contact_cap']);
    input.draft = { ...input.draft, contactId: '0', address: 'existing@example.com' }; input.allowlist = [...input.allowlist, 'existing@example.com'];
    // Existing sends must carry follow-up history, rather than bypass cadence.
    expect(reasons(input)).toContain('follow_up_cadence');
    input.contacts = input.contacts.map(c => ({ ...c, lastSentAt: '2026-10-23T15:00:00Z', followUpsSent: 0 }));
    expect(checkOutbound(input).ok).toBe(true);
  });
  it('does not allow a prior recipient to bypass cadence by omitting contactId', () => {
    const input = valid();
    input.contacts = [{ id: 'existing', address: input.draft.address, state: 'sent', lastSentAt: now, followUpsSent: 0 }];
    expect(reasons(input)).toContain('follow_up_cadence');
  });
  it('rejects early follow-ups, missing history, and exhausted follow-ups', () => {
    for (const history of [{}, { lastSentAt: now, followUpsSent: 0 }, { lastSentAt: '2026-10-01', followUpsSent: 2 }]) {
      const input = valid(); input.draft = { ...input.draft, contactId: 'contact', isFollowUp: true };
      input.contacts = [{ id: 'contact', address: 'test@example.com', state: 'sent', ...history }];
      expect(reasons(input)).toContain('follow_up_cadence');
    }
  });
  it('rejects unknown/mismatched or closed contacts', () => {
    const input = valid(); input.draft = { ...input.draft, contactId: 'unknown' };
    expect(reasons(input)).toContain('consent_mismatch');
    input.contacts = [{ id: 'unknown', address: 'other@example.com', state: 'declined' }];
    expect(reasons(input)).toContain('consent_mismatch');
    expect(reasons(input)).toContain('inactive_contact');
  });
  it('rejects disclosure-free body, hidden data in body/subject, and medical advice', () => {
    for (const [draft, expected] of [
      [{ body: 'Please coordinate.' }, 'missing_disclosure'],
      [{ body: withDisclosure('Fictional Plan') }, 'unshared_field'],
      [{ subject: 'SECRET-123' }, 'unshared_field'],
      [{ body: withDisclosure('I recommend surgery.') }, 'medical_advice'],
      [{ subject: 'Your prognosis is excellent.' }, 'medical_advice'],
    ] as const) {
      const input = valid(); input.draft = { ...input.draft, ...draft };
      expect(reasons(input)).toEqual([expected]);
    }
  });
  it('requires voice disclosure at the beginning and email disclosure for emails', () => {
    const input = valid(); input.draft = { ...input.draft, channel: 'voice', address: '+12025550123', body: `${AI_DISCLOSURE_VOICE} Please coordinate intake.` };
    expect(checkOutbound(input).ok).toBe(true);
    input.draft = { ...input.draft, body: `Please coordinate. ${AI_DISCLOSURE_VOICE}` };
    expect(reasons(input)).toEqual(['missing_disclosure']);
    input.draft = { ...input.draft, channel: 'email', address: 'test@example.com', body: AI_DISCLOSURE_VOICE };
    expect(reasons(input)).toEqual(['missing_disclosure']);
  });
  it('rejects invalid channel/address combinations and empty content', () => {
    const input = valid(); input.draft = { ...input.draft, channel: 'voice', body: '', address: 'test@example.com' };
    expect(reasons(input)).toContain('invalid_draft');
  });
  it('collects all independent failures', () => {
    const input = valid(); input.draft = { ...input.draft, approvedAt: null, body: 'Fictional Plan. I recommend surgery.' }; input.allowlist = []; input.contacts = Array.from({length: 5}, () => ({state: 'sent'}));
    expect(reasons(input)).toEqual(expect.arrayContaining(['not_approved','not_allowlisted','contact_cap','unshared_field','missing_disclosure','medical_advice']));
  });
});
