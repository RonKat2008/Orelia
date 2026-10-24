import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkConsultOutbound, consultTextHash, type ConsultGateInput } from '../../lib/safety/consult-gate';
import { AI_DISCLOSURE_EMAIL, withDisclosure } from '../../lib/safety/disclosure';
import { checkOutbound, isGatedDraft } from '../../lib/safety/outbound-gate';
import { mintPhysicianExemption } from '../../lib/safety/physician-exemption';

const CASE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const ADDRESS = 'referrals@expert-center.example.org';
const EVIDENCE = [
  { id: 'ev-cp', claimType: 'contact_point.email.referral_coordinator', claim: ADDRESS, sourceUrl: 'https://expert-center.example.org/refer', sourceKind: 'exa' },
  { id: 'ev-free', claimType: 'page_excerpt', claim: `Email ${ADDRESS} for consults`, sourceUrl: 'https://expert-center.example.org/about', sourceKind: 'exa' },
];
const SUBJECT = 'Physician consultation request: Synthetic Rare Disease';
// Clinician-to-clinician question that the patient-advice phrase filter would flag.
const BODY = withDisclosure('Dear colleague,\nWould you recommend surgery or radiation for this patient with Synthetic Rare Disease?\nThe referring physician reviewed and approved this request.');

function input(over: Partial<ConsultGateInput['consult']> = {}, rest: Partial<Omit<ConsultGateInput, 'consult'>> = {}): ConsultGateInput {
  const subject = over.subject ?? SUBJECT;
  const body = over.body ?? BODY;
  return {
    consult: {
      caseId: CASE, targetId: TARGET, status: 'ready', subject, body, sharedFields: ['diseaseName'],
      doctorApprovedAt: '2026-10-20T10:00:00.000Z', patientConsentAt: '2026-10-21T10:00:00.000Z',
      approvedBodyHash: consultTextHash(SUBJECT, BODY), expertAddress: ADDRESS, addressEvidenceId: 'ev-cp',
      ...over,
    },
    evidence: EVIDENCE,
    caseRecord: { diseaseName: 'Synthetic Rare Disease', insurer: 'Fictional Health Co' },
    contacts: [],
    allowlist: [ADDRESS],
    now: '2026-10-22T10:00:00.000Z',
    mode: 'dev',
    ...rest,
  };
}

const reasons = (i: ConsultGateInput) => { const r = checkConsultOutbound(i); return r.ok ? [] : r.reasons; };

describe('checkConsultOutbound', () => {
  it('happy path: returns a real GatedDraft to the evidence-backed address with the approved text', () => {
    const r = checkConsultOutbound(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isGatedDraft(r.payload)).toBe(true);
    expect(r.payload.address).toBe(ADDRESS);
    expect(r.payload.body).toBe(BODY);
    expect(r.payload.approvedAt).toBe('2026-10-21T10:00:00.000Z');
    expect(r.payload.caseData).toEqual({ diseaseName: 'Synthetic Rare Disease' });
  });

  it.each(['drafted', 'sent_to_doctor', 'doctor_declined', 'sent', 'cancelled', 'failed'])('refuses status %s', status => {
    expect(reasons(input({ status }))).toContain('consult_not_ready');
  });

  it('refuses without doctor approval or with an approval in the future', () => {
    expect(reasons(input({ doctorApprovedAt: null }))).toContain('no_doctor_approval');
    expect(reasons(input({ doctorApprovedAt: '2026-10-23T10:00:00.000Z', patientConsentAt: '2026-10-23T11:00:00.000Z' }))).toContain('no_doctor_approval');
  });

  it('refuses without patient consent, consent in the future, or consent given before the doctor approved', () => {
    expect(reasons(input({ patientConsentAt: null }))).toContain('no_patient_consent');
    expect(reasons(input({ patientConsentAt: '2026-10-23T10:00:00.000Z' }))).toContain('no_patient_consent');
    expect(reasons(input({ patientConsentAt: '2026-10-19T10:00:00.000Z' }))).toContain('consent_before_doctor_approval');
  });

  it('refuses when the subject or body changed after the doctor approved, or no hash exists', () => {
    expect(reasons(input({ body: `${BODY}\nP.S. extra line` }))).toContain('text_changed_after_approval');
    expect(reasons(input({ subject: 'Changed subject' }))).toContain('text_changed_after_approval');
    expect(reasons(input({ approvedBodyHash: null }))).toContain('text_changed_after_approval');
  });

  it('refuses without an expert address, and when the address is not a code-stamped contact point', () => {
    expect(reasons(input({ expertAddress: null, addressEvidenceId: null }))).toEqual(['no_expert_address']);
    expect(reasons(input({ addressEvidenceId: 'ev-free' }))).toContain('address_not_evidence_backed');
    expect(reasons(input({ addressEvidenceId: null }))).toContain('address_not_evidence_backed');
    expect(reasons(input({ expertAddress: 'attacker@evil.example.net' }))).toContain('address_not_evidence_backed');
    expect(reasons(input({}, { evidence: [] }))).toContain('address_not_evidence_backed');
  });

  it('delegates to checkOutbound: allowlist, disclosure and unshared fields still apply', () => {
    expect(reasons(input({}, { allowlist: [] }))).toContain('not_allowlisted');
    const noDisclosure = BODY.replace(AI_DISCLOSURE_EMAIL, '');
    expect(reasons(input({ body: noDisclosure, approvedBodyHash: consultTextHash(SUBJECT, noDisclosure) }))).toContain('missing_disclosure');
    const leaky = `${BODY}\nInsurance: Fictional Health Co`;
    expect(reasons(input({ body: leaky, approvedBodyHash: consultTextHash(SUBJECT, leaky) }))).toContain('unshared_field');
  });

  it('counts the cap per resource: a 6th resource is refused, the same resource is not a new contact', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(t => ({ id: t, targetId: `other-${t}`, address: `intake@${t}.example.org`, state: 'sent' }));
    expect(reasons(input({}, { contacts: five }))).toContain('contact_cap');
    const sameResource = [...five.slice(0, 4), { id: 'x', targetId: TARGET, address: 'intake@expert-center.example.org', state: 'drafted' }];
    expect(checkConsultOutbound(input({}, { contacts: sameResource })).ok).toBe(true);
  });

  it('a same-address contact that was already emailed keeps its follow-up cadence', () => {
    const contacts = [{ id: 'x', targetId: TARGET, address: ADDRESS, state: 'sent', lastSentAt: '2026-10-21T12:00:00.000Z', followUpsSent: 0 }];
    expect(reasons(input({}, { contacts }))).toContain('follow_up_cadence');
  });
});

describe('physician exemption is narrow', () => {
  const draft = { channel: 'email' as const, address: ADDRESS, subject: SUBJECT, body: BODY, approvedAt: '2026-10-21T10:00:00.000Z' };
  const base = { consent: { sharedFields: ['diseaseName'] }, caseRecord: { diseaseName: 'Synthetic Rare Disease' }, contacts: [], allowlist: [ADDRESS], now: '2026-10-22T10:00:00.000Z', mode: 'dev' as const };

  it('without an exemption checkOutbound still refuses the clinical question as medical_advice', () => {
    const r = checkOutbound({ ...base, draft });
    expect(r.ok ? [] : r.reasons).toEqual(['medical_advice']);
  });

  it('a look-alike object, or an exemption for different text/address, does not skip the filter', () => {
    const fake = Object.freeze({ kind: 'physician_authored_clinician_message', address: ADDRESS, subject: SUBJECT, body: BODY });
    expect(checkOutbound({ ...base, draft, physicianAuthored: fake as never }).ok).toBe(false);
    const other = mintPhysicianExemption({ address: ADDRESS, subject: SUBJECT, body: `${BODY} ` });
    expect(checkOutbound({ ...base, draft, physicianAuthored: other! }).ok).toBe(false);
    const elsewhere = mintPhysicianExemption({ address: 'intake@other.example.org', subject: SUBJECT, body: BODY });
    expect(checkOutbound({ ...base, draft, physicianAuthored: elsewhere! }).ok).toBe(false);
  });

  it('the exemption skips only the advice filter, never disclosure or unshared-field checks', () => {
    const body = 'Would you recommend surgery? Insurance: Fictional Health Co';
    const e = mintPhysicianExemption({ address: ADDRESS, subject: SUBJECT, body });
    const r = checkOutbound({ ...base, caseRecord: { insurer: 'Fictional Health Co' }, draft: { ...draft, body }, physicianAuthored: e! });
    expect(r.ok ? [] : [...r.reasons].sort()).toEqual(['missing_disclosure', 'unshared_field']);
  });

  it('only lib/safety/consult-gate.ts mints exemptions', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(relative(root, p));
      }
    };
    for (const dir of ['lib', 'app', 'components', 'scripts']) { try { walk(join(root, dir)); } catch { /* missing dir */ } }
    const callers = files.filter(f => readFileSync(join(root, f), 'utf8').includes('mintPhysicianExemption'));
    expect(callers.sort()).toEqual(['lib/safety/consult-gate.ts', 'lib/safety/physician-exemption.ts']);
  });
});
