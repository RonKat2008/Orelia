import { describe, expect, it } from 'vitest';
import { MockMailer } from '@/lib/channels/mock-mailer';
import { emailDomainTrusted, trustedDoctorDomains } from '@/lib/coordination/consult/doctor-domain';
import { ConsultError, type DoctorDomainEvidence } from '@/lib/coordination/consult/service';
import { CASE, DOCTOR_NPI, EXPERT_ADDRESS, harness, later, RESOURCE_KEY, tokenFrom, type Harness } from './consult-fixture';

/**
 * Doctor impersonation (stress-security #3): a real doctor's public name + NPI passes NPPES, so a patient could add
 * an address they own and approve the request themselves. Verification now also needs the email domain to match a
 * domain we hold code-stamped evidence for (institution page / affiliation for that doctor's NPI).
 */

const CLINICAL = 'Would you recommend surgery or radiation for this patient?';
const AUDIT = { ip: '203.0.113.50', userAgent: 'Synthetic Browser/1.0' };
const addClinical = (body: string) => body.replace('Could you let me know', `${CLINICAL}\n\nCould you let me know`);
const reject = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof ConsultError) return e; throw e; } throw new Error('expected refusal'); };

const CLINIC_EVIDENCE: DoctorDomainEvidence[] = [
  { claimType: 'identity.affiliation', claim: 'Department of Orthopaedic Oncology, Synthetic Clinic, Cleveland, OH. Electronic address: lee@ccf.example.org.', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/12345678/' },
  { claimType: 'institution.page', claim: 'Synthetic Clinic sarcoma program', sourceUrl: 'https://www.clevelandclinic.example.org/departments/sarcoma' },
];

function domainHarness(doctorEmail: string, evidence: DoctorDomainEvidence[] = CLINIC_EVIDENCE): Harness {
  const allowlist = [doctorEmail, EXPERT_ADDRESS];
  const mailer = new MockMailer({ allowlist });
  const h = harness({ email: () => mailer, doctorDomainEvidence: async (caseId, npi) => (caseId === CASE && npi === DOCTOR_NPI ? evidence : []) });
  h.deps.env = { ...h.deps.env, OUTBOUND_ALLOWLIST: allowlist.join(',') };
  h.mailer = mailer;
  return h;
}

const addDoctor = (h: Harness, email: string) => h.svc.addDoctor(CASE, { name: 'Dr. Synthetic Lee', practice: 'Synthetic Clinic', email, npi: DOCTOR_NPI });

async function approveAndSend(h: Harness, doctorId: string) {
  const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId, sharedFields: ['diseaseName'] });
  await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'send_to_doctor' });
  const token = tokenFrom(h.mailer.sent.at(-1)!.body);
  later(h, 30);
  const view = (await h.svc.reviewView(token))!;
  await h.svc.reviewDecide(token, { decision: 'approve', subject: view.subject, body: addClinical(view.body) }, AUDIT);
  const approved = (await h.store.get(CASE, 'consult', consult.id))!;
  const ready = await h.svc.patch(CASE, approved.id, { version: approved.version, action: 'consent' });
  return { token, send: () => h.svc.patch(CASE, ready.id, { version: ready.version, action: 'send' }) };
}

describe('email domain matching', () => {
  const domains = trustedDoctorDomains(CLINIC_EVIDENCE);

  it('trusts institution hosts (www stripped) and affiliation email domains, never registry hosts', () => {
    expect(domains).toEqual(expect.arrayContaining(['clevelandclinic.example.org', 'ccf.example.org']));
    expect(domains.some(d => d.endsWith('nih.gov'))).toBe(false);
  });

  it.each([
    ['exact domain', 'dr.lee@clevelandclinic.example.org', true],
    ['subdomain of the evidence domain', 'dr.lee@dept.clevelandclinic.example.org', true],
    ['affiliation email domain', 'lee@ccf.example.org', true],
    ['uppercase', 'Dr.Lee@CLEVELANDCLINIC.EXAMPLE.ORG', true],
    ['lookalike suffix', 'dr.lee@clevelandclinic.example.org.evil.com', false],
    ['lookalike prefix', 'dr.lee@evil-clevelandclinic.example.org', false],
    ['patient-owned domain', 'dr.lee@lee-family.example.net', false],
    ['a registry host', 'dr.lee@pubmed.ncbi.nlm.nih.gov', false],
  ])('%s', (_l, email, ok) => {
    expect(emailDomainTrusted(email, domains)).toBe(ok);
  });

  it('never trusts a bare public suffix from the evidence', () => {
    expect(emailDomainTrusted('x@anything.org', ['org'])).toBe(false);
  });
});

describe('doctor verification needs an evidenced email domain', () => {
  it('patient-owned domain: unverified, and the clinical question is refused by the standard filter', async () => {
    const h = domainHarness('dr.lee@lee-family.example.net');
    const d = await addDoctor(h, 'dr.lee@lee-family.example.net');
    expect(d).toMatchObject({ verified: false, verificationReason: 'email_domain_unverified' });
    const { send } = await approveAndSend(h, d.id);
    const e = await reject(send());
    expect(e.reasons).toContain('medical_advice');
  });

  it('affiliation domain: verified, and the clinical question gets the physician exemption', async () => {
    const h = domainHarness('lee@ccf.example.org');
    const d = await addDoctor(h, 'lee@ccf.example.org');
    expect(d).toMatchObject({ verified: true, verificationReason: 'verified' });
    const { send } = await approveAndSend(h, d.id);
    expect((await send()).status).toBe('sent');
    expect(h.mailer.sent.at(-1)!.body).toContain(CLINICAL);
  });

  it('subdomain of the institution domain: verified', async () => {
    const h = domainHarness('dr.lee@dept.clevelandclinic.example.org');
    expect(await addDoctor(h, 'dr.lee@dept.clevelandclinic.example.org')).toMatchObject({ verified: true });
  });

  it('lookalike domain: unverified', async () => {
    const h = domainHarness('dr.lee@clevelandclinic.example.org.evil.com');
    expect(await addDoctor(h, 'dr.lee@clevelandclinic.example.org.evil.com')).toMatchObject({ verified: false, verificationReason: 'email_domain_unverified' });
  });

  it('no domain evidence for this NPI: unverified', async () => {
    const h = domainHarness('dr.lee@clevelandclinic.example.org', []);
    expect(await addDoctor(h, 'dr.lee@clevelandclinic.example.org')).toMatchObject({ verified: false, verificationReason: 'email_domain_unverified' });
  });
});

describe('the review link is single-use and bound to the doctor email', () => {
  it('a link cannot be opened or used again after a decision', async () => {
    const h = domainHarness('lee@ccf.example.org');
    const d = await addDoctor(h, 'lee@ccf.example.org');
    const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: d.id, sharedFields: [] });
    await h.svc.patch(CASE, consult.id, { version: 1, action: 'send_to_doctor' });
    const token = tokenFrom(h.mailer.sent.at(-1)!.body);
    await h.svc.reviewDecide(token, { decision: 'decline', note: 'Not now' }, AUDIT);
    expect(await h.svc.reviewView(token)).toBeNull();
    const stored = (await h.store.get(CASE, 'consult', consult.id))!;
    expect(stored.reviewTokenUsedAt).toEqual(expect.any(String));
    expect(stored.reviewTokenEmail).toBe('lee@ccf.example.org');
    const e = await reject(h.svc.reviewDecide(token, { decision: 'decline' }, AUDIT));
    expect(e.status).toBe(409);
  });

  it('a link stops working when the doctor on the request no longer has the email it was sent to', async () => {
    const h = domainHarness('lee@ccf.example.org');
    const d = await addDoctor(h, 'lee@ccf.example.org');
    const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: d.id, sharedFields: [] });
    await h.svc.patch(CASE, consult.id, { version: 1, action: 'send_to_doctor' });
    const token = tokenFrom(h.mailer.sent.at(-1)!.body);
    await h.store.save(CASE, 'doctor', d.id, { ...d, email: 'me@lee-family.example.net' });
    expect(await h.svc.reviewView(token)).toBeNull();
    const view = await reject(h.svc.reviewDecide(token, { decision: 'approve', subject: 'x', body: 'y' }, AUDIT));
    expect(view.status).toBe(404);
  });
});
