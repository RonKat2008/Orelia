import { describe, expect, it } from 'vitest';
import { buildConsultDraft, doctorReviewEmail, draftProblems, ensureFooter, physicianApprovalLine, polishConsultDraft } from '@/lib/coordination/consult/draft';
import { classifyConsultText, discoverConsultProcess, pickExpertAddress } from '@/lib/coordination/consult/process';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import { flagMedicalAdvice } from '@/lib/safety/no-medical-advice';
import { EXPERT_ADDRESS, RECORD, resource } from './consult-fixture';

const doctor = { id: '33333333-3333-4333-8333-333333333333', caseId: '11111111-1111-4111-8111-111111111111', name: 'Dr. Synthetic Lee', practice: 'Synthetic Family Practice', email: 'dr.lee@clinic.example.org', createdAt: '2026-10-01T00:00:00.000Z' };
const process = { kind: 'econsult' as const, detail: 'x', sourceUrl: 'https://expert-center.example.org/physicians', expertAddress: EXPERT_ADDRESS, addressEvidenceId: 'ev-cp' };

describe('consult process discovery', () => {
  it.each([
    ['We offer physician-to-physician e-consults.', 'econsult'],
    ['Cases are presented at our weekly multidisciplinary tumor board.', 'tumor_board'],
    ['Call our physician referral line for a peer-to-peer discussion.', 'peer_to_peer'],
    ['Our remote second opinion program provides an expert case review.', 'case_review'],
    ['New patients are seen by physician referral only.', 'referral_only'],
  ])('classifies %s', (text, kind) => {
    expect(classifyConsultText(text)?.kind).toBe(kind);
  });

  it('finds the process on evidence pages; the address comes only from the contact point row', async () => {
    const p = await discoverConsultProcess(resource(), { exa: null });
    expect(p).toMatchObject({ kind: 'econsult', sourceUrl: 'https://expert-center.example.org/physicians', expertAddress: EXPERT_ADDRESS, addressEvidenceId: 'ev-cp' });
    expect(p!.detail).not.toMatch(/attacker/);
  });

  it('never mines an address from free text', async () => {
    const r = resource([{ id: 'ev-page', claimType: 'page_excerpt', claim: 'E-consult requests: referrals@expert-center.example.org', sourceUrl: 'https://expert-center.example.org/physicians', sourceKind: 'exa' } as never]);
    const p = await discoverConsultProcess(r, { exa: null });
    expect(p?.kind).toBe('econsult');
    expect(p?.expertAddress).toBeNull();
    expect(pickExpertAddress(r.evidence)).toBeNull();
  });

  it('searches Exa only on the resource domain and keeps the fetched URL', async () => {
    const r = resource([{ id: 'ev-cp', claimType: 'contact_point.email.referral_coordinator', claim: EXPERT_ADDRESS, sourceUrl: 'https://expert-center.example.org/refer', sourceKind: 'exa' } as never]);
    const exa = { search: async () => ({ records: [
      { url: 'https://other.example.net/x', text: 'Tumor board for all.' },
      { url: 'https://expert-center.example.org/tumor-board', text: 'Our tumor board reviews outside cases.' },
    ] }) };
    const p = await discoverConsultProcess(r, { exa });
    expect(p).toMatchObject({ kind: 'tumor_board', sourceUrl: 'https://expert-center.example.org/tumor-board' });
  });

  it('falls back to unknown with a read source, or null when nothing was read', async () => {
    const r = resource([{ id: 'ev-cp', claimType: 'contact_point.email.referral_coordinator', claim: EXPERT_ADDRESS, sourceUrl: 'https://expert-center.example.org/refer', sourceKind: 'exa' } as never]);
    expect(await discoverConsultProcess(r, { exa: null })).toMatchObject({ kind: 'unknown', sourceUrl: 'https://expert-center.example.org/refer' });
    expect(await discoverConsultProcess(resource([]), { exa: null })).toBeNull();
  });
});

describe('consult draft', () => {
  it('contains only ticked fields, the approval line and the disclosure, and passes the advice filter', () => {
    const d = buildConsultDraft({ expertName: 'Synthetic Expert Center', process, doctor, caseRecord: RECORD, sharedFields: ['diseaseName', 'goals'], packetText: null });
    expect(d.subject).toContain('Synthetic Rare Disease');
    expect(d.body).toContain('Diagnosis: Synthetic Rare Disease');
    expect(d.body).toContain('Patient goals: second opinion');
    expect(d.body).not.toContain('Fictional Health');
    expect(d.body).not.toContain('Springfield');
    expect(d.body).toContain(physicianApprovalLine(doctor));
    expect(d.body.endsWith(AI_DISCLOSURE_EMAIL)).toBe(true);
    expect(flagMedicalAdvice(`${d.subject}\n${d.body}`).flagged).toBe(false);
    expect(draftProblems(d, RECORD, ['diseaseName', 'goals'], doctor)).toEqual([]);
  });

  it('with nothing shared, the draft says so and leaks nothing', () => {
    const d = buildConsultDraft({ expertName: 'Synthetic Expert Center', process, doctor, caseRecord: RECORD, sharedFields: [], packetText: null });
    expect(d.subject).toBe('Physician consultation request');
    expect(draftProblems(d, RECORD, [], doctor)).toEqual([]);
  });

  it('a packet mentioning an unticked field is caught', () => {
    const d = buildConsultDraft({ expertName: 'Synthetic Expert Center', process, doctor, caseRecord: RECORD, sharedFields: [], packetText: 'Summary\n- Synthetic Rare Disease confirmed 2026-01-02' });
    expect(draftProblems(d, RECORD, [], doctor)).toContain('unshared_field');
  });

  it('ensureFooter restores a removed disclosure or approval line, keeping the disclosure last', () => {
    const stripped = ensureFooter('Dear colleague, thanks.', doctor);
    expect(stripped.added).toBe(true);
    expect(stripped.body).toContain(physicianApprovalLine(doctor));
    expect(stripped.body.endsWith(AI_DISCLOSURE_EMAIL)).toBe(true);
    expect(ensureFooter(stripped.body, doctor)).toEqual({ body: stripped.body, added: false });
  });

  it('LLM polish is kept only when it passes every check', async () => {
    const base = buildConsultDraft({ expertName: 'X', process, doctor, caseRecord: RECORD, sharedFields: ['diseaseName'], packetText: null });
    const ctx = { record: RECORD, sharedFields: ['diseaseName'], doctor };
    expect((await polishConsultDraft(base, async () => ({ subject: 'S', body: 'You should start chemotherapy now.' }), ctx)).polished).toBe(false);
    expect((await polishConsultDraft(base, async () => ({ subject: 'S', body: 'Insurer Fictional Health Co.' }), ctx)).polished).toBe(false);
    expect((await polishConsultDraft(base, async () => { throw new Error('down'); }, ctx)).polished).toBe(false);
    const ok = await polishConsultDraft(base, async () => ({ subject: 'Consult request', body: 'Dear colleagues, could your team review this case?' }), ctx);
    expect(ok.polished).toBe(true);
    expect(ok.body).toContain(AI_DISCLOSURE_EMAIL);
  });

  it('the doctor email carries the link and expert name only, plus the disclosure', () => {
    const m = doctorReviewEmail({ doctor, expertName: 'Synthetic Expert Center', url: 'https://app.example.org/review/tok', expiresAt: '2026-11-03T10:00:00.000Z' });
    expect(m.body).toContain('https://app.example.org/review/tok');
    expect(m.body).toContain('Synthetic Expert Center');
    expect(m.body).toContain(AI_DISCLOSURE_EMAIL);
    expect(m.body).not.toMatch(/Synthetic Rare Disease|Fictional|Springfield/);
  });
});
