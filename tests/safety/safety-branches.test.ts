import { describe, expect, it } from 'vitest';
import { activeTargetIds } from '../../lib/safety/caps';
import { formatFieldValue } from '../../lib/safety/field-value';
import { flagMedicalAdviceTwoStage } from '../../lib/safety/no-medical-advice';
import { AI_DISCLOSURE_EMAIL, withDisclosure } from '../../lib/safety/disclosure';
import { checkOutbound, isGatedDraft, type OutboundInput } from '../../lib/safety/outbound-gate';
import { isWebAllowed } from '../../lib/safety/web-allowlist';
import type { WebFormDraftPayload } from '../../lib/safety/types';

const now = '2026-10-28T16:00:00Z';
const approvedAt = '2026-10-28T15:00:00Z';
const WEB_URL = 'https://clinic.example.org/apply';

function emailInput(): OutboundInput {
  return {
    draft: { channel: 'email', address: 'test@example.com', body: withDisclosure('Please coordinate a rare disease second opinion.'), approvedAt },
    consent: { sharedFields: ['diseaseName'] },
    caseRecord: { diseaseName: 'rare disease', planId: 'SECRET-123' },
    contacts: [], allowlist: ['test@example.com'], now, mode: 'demo',
  };
}
function webForm(): WebFormDraftPayload {
  return {
    formFingerprint: 'fp-1',
    fields: [{ fieldKey: 'dx', label: 'Diagnosis', type: 'text', value: 'rare disease', source: { kind: 'consent', key: 'diseaseName' } }],
    uploads: [], hasFreeText: false,
  };
}
function webInput(): OutboundInput {
  return {
    draft: { channel: 'web_form', address: WEB_URL, body: 'Submitting application form.', approvedAt, webForm: webForm() },
    consent: { sharedFields: ['diseaseName'] },
    caseRecord: { diseaseName: 'rare disease', planId: 'SECRET-123' },
    contacts: [], allowlist: [], webAllowlist: ['clinic.example.org'], now, mode: 'demo',
  };
}
function refusals(input: OutboundInput): string[] {
  const result = checkOutbound(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.reasons;
}

describe('caps.activeTargetIds identity fallbacks', () => {
  it('keys contacts without a target by id, then address, then position, and ignores terminal ones', () => {
    // Arrange
    const contacts = [
      { id: 'c1', state: 'sent' },
      { address: 'a@example.com', state: 'sent' },
      { state: 'sent' },
      { id: 'done', state: 'declined', targetId: 'gone' },
    ];
    // Act
    const ids = activeTargetIds(contacts);
    // Assert
    expect([...ids].sort()).toEqual(['c:2', 'c:a@example.com', 'c:c1']);
  });
});

describe('formatFieldValue list handling', () => {
  it('drops non-finite numbers, empty strings and non-scalar list items', () => {
    expect(formatFieldValue([1, ' a ', Number.NaN, null, '', {}, 'b'])).toBe('1, a, b');
  });
  it('returns undefined when no list item is usable', () => {
    expect(formatFieldValue([Number.NaN, null, '  '])).toBeUndefined();
  });
  it('returns undefined for unsupported scalar types', () => {
    expect(formatFieldValue(true)).toBeUndefined();
    expect(formatFieldValue(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('flagMedicalAdviceTwoStage classifier edge cases', () => {
  const clean = 'Requesting an appointment for a rare disease evaluation.';
  it('flags with the classifier reason when one is supplied', async () => {
    const result = await flagMedicalAdviceTwoStage(clean, { classify: async () => ({ flagged: true, reason: 'looks like advice' }) });
    expect(result).toMatchObject({ flagged: true, stage: 'classifier', rules: ['classifier'], reason: 'looks like advice' });
  });
  it('flags without a reason key when the classifier gives none', async () => {
    const result = await flagMedicalAdviceTwoStage(clean, { classify: async () => ({ flagged: true }) });
    expect(result.flagged).toBe(true);
    expect(result).not.toHaveProperty('reason');
  });
  it('fails closed with the Error message when the classifier throws an Error', async () => {
    const result = await flagMedicalAdviceTwoStage(clean, { classify: async () => { throw new Error('model offline'); } });
    expect(result).toMatchObject({ flagged: true, rules: ['classifier-error'], reason: 'model offline' });
  });
  it('fails closed with a stringified reason when a non-Error is thrown', async () => {
    const result = await flagMedicalAdviceTwoStage(clean, { classify: async () => { throw 'boom'; } });
    expect(result).toMatchObject({ flagged: true, rules: ['classifier-error'], reason: 'boom' });
  });
  it('passes through as unflagged only when the classifier clears the text', async () => {
    const result = await flagMedicalAdviceTwoStage(clean, { classify: async () => ({ flagged: false }) });
    expect(result).toMatchObject({ flagged: false, stage: 'none' });
  });
});

describe('isWebAllowed with malformed allowlist entries', () => {
  it('ignores unparseable entries and refuses when nothing valid matches', () => {
    expect(isWebAllowed(WEB_URL, ['https://clinic.example.org', '*.example.org', 'clinic.example.org:99999'])).toBe(false);
  });
  it('still allows a valid entry listed after an invalid one', () => {
    expect(isWebAllowed(WEB_URL, ['not a host', 'clinic.example.org'])).toBe(true);
  });
});

describe('outbound gate: web form refusals', () => {
  it('refuses a web draft that is not approved and does not mint a payload', () => {
    const input = webInput();
    input.draft = { ...input.draft, approvedAt: null };
    expect(refusals(input)).toEqual(['not_approved']);
  });
  it('refuses when the consent is bound to a different contact than the draft', () => {
    const input = webInput();
    input.consent = { ...input.consent, contactId: 'other' };
    expect(refusals(input)).toContain('consent_mismatch');
  });
  it('refuses a disclosure-sourced field whose value is not text', () => {
    const input = webInput();
    const form = webForm();
    input.draft = { ...input.draft, webForm: { ...form, fields: [{ fieldKey: 'ack', label: 'Ack', type: 'checkbox', value: true, source: { kind: 'disclosure' } }] } };
    expect(refusals(input)).toContain('missing_disclosure');
  });
  it('fails closed on a field with an unrecognised source kind', () => {
    const input = webInput();
    const form = webForm();
    const rogue = { ...form.fields[0], source: { kind: 'unknown' } } as unknown as WebFormDraftPayload['fields'][number];
    input.draft = { ...input.draft, webForm: { ...form, fields: [rogue] } };
    expect(refusals(input)).toContain('invalid_draft');
  });
  it('mints a gated payload carrying subject, contact and case ids only when the draft has them', () => {
    const input = webInput();
    input.draft = { ...input.draft, subject: 'Application', contactId: 'c1', caseId: 'case-1' };
    input.contacts = [{ id: 'c1', caseId: 'case-1', address: WEB_URL, state: 'drafted' }];
    const result = checkOutbound(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isGatedDraft(result.payload)).toBe(true);
      expect(result.payload).toMatchObject({ subject: 'Application', contactId: 'c1', caseId: 'case-1' });
    }
  });
  it('omits optional ids from the web payload when the draft lacks them', () => {
    const result = checkOutbound(webInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).not.toHaveProperty('subject');
      expect(result.payload).not.toHaveProperty('contactId');
      expect(result.payload).not.toHaveProperty('caseId');
    }
  });
});

describe('outbound gate: email consent binding and payload shape', () => {
  it('refuses when consent names a contact but the draft names none', () => {
    const input = emailInput();
    input.consent = { ...input.consent, contactId: 'c1' };
    expect(refusals(input)).toContain('consent_mismatch');
  });
  it('refuses when consent names a different contact than the draft', () => {
    const input = emailInput();
    input.contacts = [{ id: 'c1', address: 'test@example.com', state: 'drafted' }];
    input.draft = { ...input.draft, contactId: 'c1' };
    input.consent = { ...input.consent, contactId: 'c2' };
    expect(refusals(input)).toContain('consent_mismatch');
  });
  it('reports consent_mismatch once when several mismatch checks fail together', () => {
    const input = emailInput();
    input.contacts = [{ id: 'c1', caseId: 'case-other', address: 'someone-else@example.com', state: 'drafted' }];
    input.draft = { ...input.draft, contactId: 'c1', caseId: 'case-1' };
    input.consent = { ...input.consent, contactId: 'c2' };
    expect(refusals(input).filter(reason => reason === 'consent_mismatch')).toHaveLength(1);
  });
  it('refuses a draft that names an unknown contact', () => {
    const input = emailInput();
    input.draft = { ...input.draft, contactId: 'ghost' };
    expect(refusals(input)).toContain('consent_mismatch');
  });
  it('carries subject, contact, case and follow-up flag into the payload when present', () => {
    const input = emailInput();
    input.contacts = [{ id: 'c1', caseId: 'case-1', address: 'test@example.com', state: 'sent', lastSentAt: '2026-10-01T12:00:00Z', followUpsSent: 0 }];
    input.draft = { ...input.draft, subject: 'Follow up', contactId: 'c1', caseId: 'case-1', isFollowUp: true };
    const result = checkOutbound(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toMatchObject({ subject: 'Follow up', contactId: 'c1', caseId: 'case-1', isFollowUp: true });
  });
  it('omits optional keys from the email payload when the draft lacks them', () => {
    const result = checkOutbound(emailInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const key of ['subject', 'contactId', 'caseId', 'isFollowUp']) expect(result.payload).not.toHaveProperty(key);
      expect(result.payload.body).toContain(AI_DISCLOSURE_EMAIL);
    }
  });
});
