import { describe, expect, it } from 'vitest';
import { AI_DISCLOSURE_EMAIL } from '../../lib/safety/disclosure';
import { checkOutbound, isGatedDraft, type GatedDraft, type OutboundInput } from '../../lib/safety/outbound-gate';
import { isWebAllowed, parseWebAllowlist } from '../../lib/safety';
import type { WebFormDraftPayload, WebFormFieldValue } from '../../lib/safety/types';

const now = '2026-10-28T16:00:00Z';
const URL_OK = 'http://localhost:3000/apply/trial-42';
const disclosureNote = `Notes: rare disease referral. ${AI_DISCLOSURE_EMAIL}`;

function fields(): WebFormFieldValue[] {
  return [
    { fieldKey: 'name', label: 'Name', type: 'text', value: 'Jane Doe', source: { kind: 'consent', key: 'patientName' } },
    { fieldKey: 'dx', label: 'Diagnosis', type: 'text', value: 'rare disease', source: { kind: 'consent', key: 'diseaseName' } },
    { fieldKey: 'stage', label: 'Stage', type: 'text', value: 'Localized', source: { kind: 'doc', docId: 'doc-1', snippet: 'Localized' } },
    { fieldKey: 'notes', label: 'Notes', type: 'textarea', value: disclosureNote, source: { kind: 'disclosure' } },
  ];
}
function webForm(overrides: Partial<WebFormDraftPayload> = {}): WebFormDraftPayload {
  return { formFingerprint: 'fp-1', fields: fields(), uploads: [{ fieldKey: 'records', docId: 'doc-1', name: 'records.pdf' }], hasFreeText: true, ...overrides };
}
function valid(): OutboundInput {
  return {
    draft: { channel: 'web_form', address: `  ${URL_OK} `, body: 'Submitting trial application form.', approvedAt: '2026-10-28T15:00:00Z', caseId: 'case-1', webForm: webForm() },
    consent: { sharedFields: ['patientName', 'diseaseName'], sharedDocIds: ['doc-1'] },
    caseRecord: { patientName: 'Jane Doe', diseaseName: 'rare disease', planId: 'SECRET-123' },
    contacts: [], allowlist: [], webAllowlist: ['localhost:3000'], now, mode: 'demo',
  };
}
function reasons(input: OutboundInput): string[] {
  const result = checkOutbound(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.reasons;
}
function withFields(input: OutboundInput, list: WebFormFieldValue[], extra: Partial<WebFormDraftPayload> = {}): OutboundInput {
  return { ...input, draft: { ...input.draft, webForm: webForm({ fields: list, ...extra }) } };
}

describe('web allowlist', () => {
  it('parses, lowercases, trims and drops invalid entries', () => {
    expect(parseWebAllowlist(' LocalHost:3000 , apply.example.org,*.evil.com,https://x.org,a.org/path,,bad host,x.org:99999,127.0.0.1:8080'))
      .toEqual(['localhost:3000', 'apply.example.org', '127.0.0.1:8080']);
  });
  it('matches host:port entries and port-less hostname entries', () => {
    expect(isWebAllowed('http://localhost:3000/form', ['localhost:3000'])).toBe(true);
    expect(isWebAllowed('HTTP://LOCALHOST:3000/form', ['localhost:3000'])).toBe(true);
    expect(isWebAllowed('http://localhost:4000/form', ['localhost:3000'])).toBe(false);
    expect(isWebAllowed('https://apply.example.org/x', ['apply.example.org'])).toBe(true);
    expect(isWebAllowed('https://apply.example.org:8443/x', ['apply.example.org'])).toBe(true);
    expect(isWebAllowed('https://APPLY.Example.org/x', ['apply.example.org'])).toBe(true);
    expect(isWebAllowed('https://sub.apply.example.org/x', ['apply.example.org'])).toBe(false);
  });
  it('rejects suffix, path and userinfo tricks', () => {
    const hosts = ['localhost:3000'];
    for (const url of [
      'http://localhost:3000.evil.com/', 'https://localhost:3000.evil.com/', 'https://evil.com/localhost:3000',
      'http://localhost:3000@evil.com/', 'http://user:pass@localhost:3000/', 'http://user@localhost:3000/',
      'https://evil.com?u=localhost:3000', 'https://evil.com#localhost:3000', 'localhost:3000', 'not a url', '',
    ]) expect(isWebAllowed(url, hosts), url).toBe(false);
  });
  it('allows http only for localhost and 127.0.0.1', () => {
    expect(isWebAllowed('http://apply.example.org/x', ['apply.example.org'])).toBe(false);
    expect(isWebAllowed('http://127.0.0.1:8080/x', ['127.0.0.1:8080'])).toBe(true);
    expect(isWebAllowed('ftp://localhost:3000/x', ['localhost:3000'])).toBe(false);
    expect(isWebAllowed('javascript:alert(1)', ['localhost:3000'])).toBe(false);
  });
});

describe('web form gate', () => {
  it('mints a frozen gated payload that isGatedDraft accepts', () => {
    const result = checkOutbound(valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;
    expect(isGatedDraft(p)).toBe(true);
    expect(p.channel).toBe('web_form');
    expect(p.address).toBe(URL_OK);
    expect(p.caseId).toBe('case-1');
    expect(p.caseData).toEqual({ patientName: 'Jane Doe', diseaseName: 'rare disease' });
    expect(p.sharedDocIds).toEqual(['doc-1']);
    expect(p.webForm?.fields).toHaveLength(4);
    expect(p.webForm?.formFingerprint).toBe('fp-1');
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.webForm)).toBe(true);
    expect(Object.isFrozen(p.webForm!.fields[0])).toBe(true);
    expect(Object.isFrozen(p.webForm!.uploads)).toBe(true);
  });
  it('payload webForm is a copy, not the caller object', () => {
    const input = valid();
    const result = checkOutbound(input);
    if (!result.ok) throw new Error('refused');
    expect(result.payload.webForm).not.toBe(input.draft.webForm);
    expect(Object.isFrozen(input.draft.webForm)).toBe(false);
  });
  it('rejects a hand-built look-alike web payload', () => {
    const result = checkOutbound(valid());
    if (!result.ok) throw new Error('refused');
    const forged = Object.freeze({ ...result.payload, address: 'https://evil.com/' }) as unknown as GatedDraft;
    expect(isGatedDraft(forged)).toBe(false);
  });
  it('refuses without approval', () => {
    const input = valid(); input.draft = { ...input.draft, approvedAt: null };
    expect(reasons(input)).toEqual(['not_approved']);
  });
  it('refuses a future approval', () => {
    const input = valid(); input.draft = { ...input.draft, approvedAt: '2027-01-01T00:00:00Z' };
    expect(reasons(input)).toEqual(['not_approved']);
  });
  it('refuses a non-allowlisted host', () => {
    const input = valid(); input.draft = { ...input.draft, address: 'https://apply.example.org/form' };
    expect(reasons(input)).toEqual(['not_allowlisted']);
    expect(reasons({ ...valid(), webAllowlist: undefined })).toEqual(['not_allowlisted']);
  });
  it('refuses a userinfo trick host', () => {
    const input = valid(); input.draft = { ...input.draft, address: 'http://localhost:3000@evil.com/form' };
    expect(reasons(input)).toContain('not_allowlisted');
  });
  it('only bypasses the host allowlist with the explicit production override', () => {
    const input = { ...valid(), webAllowlist: [] };
    input.draft = { ...input.draft, address: 'https://apply.example.org/form' };
    expect(checkOutbound({ ...input, mode: 'prod', outboundAllowReal: 'true' }).ok).toBe(true);
    expect(reasons({ ...input, mode: 'demo', outboundAllowReal: 'true' })).toEqual(['not_allowlisted']);
  });
  it.each(['not a url', 'ftp://localhost:3000/x', 'javascript:alert(1)'])('refuses invalid address %s', address => {
    const input = valid(); input.draft = { ...input.draft, address };
    expect(reasons(input)).toContain('invalid_draft');
  });
  it('refuses a missing or empty webForm', () => {
    const input = valid(); input.draft = { ...input.draft, webForm: undefined };
    expect(reasons(input)).toContain('invalid_draft');
    expect(reasons(withFields(valid(), []))).toContain('invalid_draft');
  });
  it('refuses an unticked consent field', () => {
    const input = valid(); input.consent = { ...input.consent, sharedFields: ['diseaseName'] };
    expect(reasons(input)).toContain('unshared_field');
  });
  it('refuses a consent value differing from the case record', () => {
    const list = fields(); list[0] = { ...list[0], value: 'John Smith' };
    expect(reasons(withFields(valid(), list))).toEqual(['consent_mismatch']);
  });
  it('refuses an unticked doc source', () => {
    const list = fields(); list[2] = { ...list[2], source: { kind: 'doc', docId: 'doc-2', snippet: 'Localized' } };
    expect(reasons(withFields(valid(), list))).toEqual(['unshared_field']);
  });
  it('refuses an unticked upload doc', () => {
    const input = valid();
    input.draft = { ...input.draft, webForm: webForm({ uploads: [{ fieldKey: 'records', docId: 'doc-9', name: 'x.pdf' }] }) };
    expect(reasons(input)).toEqual(['unshared_field']);
    expect(reasons({ ...valid(), consent: { sharedFields: ['patientName', 'diseaseName'] } })).toContain('unshared_field');
  });
  it('refuses when a textarea exists but no disclosure is present', () => {
    const list = fields().slice(0, 3);
    list.push({ fieldKey: 'notes', label: 'Notes', type: 'textarea', value: 'Referral notes.', source: { kind: 'doc', docId: 'doc-1', snippet: 'x' } });
    expect(reasons(withFields(valid(), list))).toEqual(['missing_disclosure']);
  });
  it('refuses a disclosure-sourced value lacking the disclosure text', () => {
    const list = fields(); list[3] = { ...list[3], value: 'Notes only.' };
    expect(reasons(withFields(valid(), list))).toEqual(['missing_disclosure']);
  });
  it('accepts no textarea when the form has no free text', () => {
    expect(checkOutbound(withFields(valid(), fields().slice(0, 3), { hasFreeText: false })).ok).toBe(true);
  });
  it('refuses unshared case data leaked into a value', () => {
    const list = fields(); list[2] = { ...list[2], value: 'Plan SECRET-123' };
    expect(reasons(withFields(valid(), list))).toEqual(['unshared_field']);
  });
  it('refuses medical advice text in a value', () => {
    const list = fields(); list[3] = { ...list[3], value: `You should stop taking your medication. ${AI_DISCLOSURE_EMAIL}` };
    expect(reasons(withFields(valid(), list))).toContain('medical_advice');
  });
  it('caps a new contact at 5 active contacts but allows the existing one', () => {
    const input = valid();
    input.contacts = Array.from({ length: 5 }, (_, i) => ({ id: String(i), caseId: 'case-1', address: `https://other${i}.org/`, state: 'sent', lastSentAt: now, followUpsSent: 0 }));
    expect(reasons(input)).toEqual(['contact_cap']);
    input.contacts = input.contacts.map((c, i) => (i === 0 ? { ...c, address: URL_OK.toUpperCase() } : c));
    // Follow-up cadence is not applied to web forms.
    expect(checkOutbound(input).ok).toBe(true);
  });
  it('refuses contact mismatches and inactive contacts', () => {
    const input = valid();
    input.contacts = [{ id: 'c1', caseId: 'case-1', address: 'http://localhost:3000/other', state: 'drafted' }];
    input.draft = { ...input.draft, contactId: 'c1' };
    expect(reasons(input)).toEqual(['consent_mismatch']);
    input.contacts = [{ id: 'c1', caseId: 'case-2', address: URL_OK, state: 'drafted' }];
    expect(reasons(input)).toEqual(['consent_mismatch']);
    input.contacts = [{ id: 'c1', caseId: 'case-1', address: URL_OK, state: 'declined' }];
    expect(reasons(input)).toEqual(['inactive_contact']);
    input.draft = { ...input.draft, contactId: 'missing' };
    expect(reasons(input)).toContain('consent_mismatch');
  });
});

describe('web gate contact cap counts resources, not addresses', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, caseId: 'case-1', targetId: `t${i}`, address: `p${i}@example.org`, state: 'sent' }));
  it('an application to a resource already contacted is not a new contact', () => {
    const input = valid();
    expect(checkOutbound({ ...input, draft: { ...input.draft, targetId: 't2' }, contacts: five })).toMatchObject({ ok: true });
  });
  it('an application to a new resource still hits the cap', () => {
    const input = valid();
    expect(reasons({ ...input, draft: { ...input.draft, targetId: 't9' }, contacts: five })).toContain('contact_cap');
    expect(reasons({ ...input, contacts: five })).toContain('contact_cap');
  });
  it('a resource whose only contact is closed does not exempt the application', () => {
    const input = valid();
    const closed = five.map(c => (c.targetId === 't2' ? { ...c, state: 'declined' } : c));
    const sixth = [...closed, { id: 'c5', caseId: 'case-1', targetId: 't5', address: 'x@example.org', state: 'sent' }];
    expect(reasons({ ...input, draft: { ...input.draft, targetId: 't2' }, contacts: sixth })).toContain('contact_cap');
  });
  it('two contacts at one resource count once toward the cap', () => {
    const input = valid();
    const shared = [...five.slice(0, 3), { id: 'c3', caseId: 'case-1', targetId: 't0', address: '+15550001', state: 'sent' }];
    expect(checkOutbound({ ...input, draft: { ...input.draft, targetId: 't9' }, contacts: [...shared, five[4]] })).toMatchObject({ ok: true });
  });
});
