import { describe, expect, it, vi } from 'vitest';
import { approveApplication, type ApproveApplicationDeps } from '@/lib/web-application/approve';
import { getAnswerQuestions, saveAnswers, type AnswerServiceDeps } from '@/lib/web-application/answer-service';
import { DEMO_PATIENT_PROFILE, answerableQuestions, identityFromAccount, usedAnswers, validateAnswers } from '@/lib/web-application/answers';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { MissingField, WebApplicationDraft } from '@/lib/web-application/types';
import { createDraft } from '@/lib/outreach/draft';
import { checkOutbound } from '@/lib/safety/outbound-gate';

const CASE = 'case-1';
const OTHER = 'case-2';
const URL_ = 'http://localhost:3000/dev/test-application';
const ENV = { OUTBOUND_WEB_ALLOWLIST: 'localhost:3000', NODE_ENV: 'test' };
const record = { diseaseName: 'vascular Ehlers-Danlos syndrome', homeState: 'OH', homeCity: 'Columbus' };
const NOW = new Date('2026-10-24T12:00:00Z');

const q = (fieldKey: string, label: string, type: string, required = true, reason: MissingField['reason'] = 'no_consented_source'): MissingField => ({
  fieldKey, label, type, required, reason, question: `What should we enter for "${label}"?`,
});

function draft(id: string, caseId = CASE): WebApplicationDraft {
  return {
    id, caseId, contactId: 'contact-1', url: URL_,
    fields: [{ fieldKey: 'diagnosis', label: 'Diagnosis *', type: 'text', value: record.diseaseName, source: { kind: 'consent', key: 'diseaseName' } }],
    missing: [
      q('first_name', 'First name *', 'text'), q('last_name', 'Last name *', 'text'), q('date_of_birth', 'Date of birth *', 'date'),
      q('email', 'Email *', 'email'), q('city', 'City', 'text', false),
      q('meds', 'Do you take any medications?', 'text', false, 'medical_question'),
    ],
    formFingerprint: 'f1-x', screenshot: null, sharedFields: ['diseaseName'], sharedDocIds: [], status: 'draft',
    approvedAt: null, submittedAt: null, result: null, createdAt: NOW.toISOString(),
  };
}

function answerDeps(store: MemoryApplicationStore, identity: AnswerServiceDeps['identity'] = async () => null): AnswerServiceDeps {
  return { applications: store, identity, now: () => NOW };
}

function approveDeps(store: MemoryApplicationStore, submit = vi.fn(async () => undefined)): ApproveApplicationDeps & { submit: typeof submit } {
  return {
    applications: store, submit, env: ENV, clock: () => NOW,
    outreach: {
      getCase: async () => record,
      consent: async () => ({ sharedFields: ['diseaseName'], approvedAt: '2026-10-24T11:00:00Z' }),
      contacts: async () => [{ id: 'contact-1', caseId: CASE, targetId: 't-1', state: 'drafted' }],
    },
  };
}

const GOOD = { first_name: 'Jordan', last_name: 'Demo', date_of_birth: '1990-01-01', email: 'ronit-1977@agentmail.to' };

describe('form questions the patient answers', () => {
  it('without answers approve is refused; with answers the mapping is complete and approve submits them', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft('app-1'));
    expect(await approveApplication('app-1', {}, approveDeps(store))).toMatchObject({ ok: false, status: 422, reasons: ['required_fields_missing'] });

    const saved = await saveAnswers(CASE, 'app-1', { answers: GOOD }, answerDeps(store));
    expect(saved.ok).toBe(true);
    const app = (await store.get('app-1'))!;
    expect(app.missing.map(m => m.fieldKey)).toEqual(['city', 'meds']); // optional city left blank; health question untouched
    expect(app.fields.find(f => f.fieldKey === 'email')).toMatchObject({ value: GOOD.email, source: { kind: 'patient', origin: 'typed' } });

    const deps = approveDeps(store);
    const res = await approveApplication('app-1', {}, deps);
    expect(res).toMatchObject({ ok: true, status: 'submitted' });
    const gated = deps.submit.mock.calls[0]![0] as unknown as { webForm: { fields: { fieldKey: string; value: string }[] } };
    expect(Object.fromEntries(gated.webForm.fields.map(f => [f.fieldKey, f.value]))).toMatchObject(GOOD);
  });

  it('a patient-typed city that matches an unticked case field is the patient\'s own consent for this form', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft('app-1'));
    await saveAnswers(CASE, 'app-1', { answers: { ...GOOD, city: 'Columbus' } }, answerDeps(store));
    expect(await approveApplication('app-1', {}, approveDeps(store))).toMatchObject({ ok: true });
  });

  it('refuses a cross-case answers write and changes nothing', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft('app-1', OTHER));
    expect(await saveAnswers(CASE, 'app-1', { answers: GOOD }, answerDeps(store))).toMatchObject({ ok: false, status: 404 });
    expect(await getAnswerQuestions(CASE, 'app-1', answerDeps(store))).toMatchObject({ ok: false, status: 404 });
    expect(await store.saveAnswers('app-1', { caseId: CASE, answers: {}, fields: [], missing: [] })).toBeUndefined();
    const row = (await store.get('app-1'))!;
    expect(row.answers ?? {}).toEqual({});
    expect(row.missing).toHaveLength(6);
  });

  it('refuses answers once the application is approved', async () => {
    const store = new MemoryApplicationStore();
    await store.save({ ...draft('app-1'), status: 'submitted' });
    expect(await saveAnswers(CASE, 'app-1', { answers: GOOD }, answerDeps(store))).toMatchObject({ ok: false, status: 409 });
  });

  it('rejects an invalid email, an impossible or future date, and over-long text', () => {
    const d = draft('app-1');
    const bad = (answers: Record<string, string>) => validateAnswers(d, { answers }, NOW);
    expect(bad({ email: 'not-an-email' })).toMatchObject({ ok: false, issues: [{ fieldKey: 'email' }] });
    expect(bad({ date_of_birth: '1990-02-30' })).toMatchObject({ ok: false, issues: [{ fieldKey: 'date_of_birth' }] });
    expect(bad({ date_of_birth: '01/01/1990' })).toMatchObject({ ok: false });
    expect(bad({ date_of_birth: '2030-01-01' })).toMatchObject({ ok: false });
    expect(bad({ first_name: 'x'.repeat(120) })).toMatchObject({ ok: false, issues: [{ fieldKey: 'first_name' }] });
    expect(bad({ meds: 'aspirin' })).toMatchObject({ ok: false, issues: [{ fieldKey: 'meds', message: 'This question cannot be answered here' }] });
    expect(bad({ nope: 'x' })).toMatchObject({ ok: false });
    expect(bad(GOOD)).toMatchObject({ ok: true });
  });

  it('never offers health questions, files or checkboxes as questions', () => {
    const d = { missing: [...draft('a').missing, q('docs', 'Documents', 'file'), q('ok', 'I authorize', 'checkbox', true, 'needs_patient')] };
    expect(answerableQuestions(d).map(x => x.fieldKey)).toEqual(['first_name', 'last_name', 'date_of_birth', 'email', 'city']);
  });

  it('sanitises answers before storing them', () => {
    const res = validateAnswers(draft('a'), { answers: { first_name: '  Jordan\u0000  ' } }, NOW);
    expect(res).toMatchObject({ ok: true, answers: { first_name: { value: 'Jordan' } } });
  });

  it('answers never leak into other applications or emails', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft('app-1'));
    await store.save(draft('app-2'));
    await saveAnswers(CASE, 'app-1', { answers: GOOD }, answerDeps(store));
    const other = (await store.get('app-2'))!;
    expect(other.answers ?? {}).toEqual({});
    expect(other.fields.some(f => f.source.kind === 'patient')).toBe(false);

    // A forged copy of app-1's answered fields on app-2 is refused by the gate: app-2 holds no answers.
    const app1 = (await store.get('app-1'))!;
    expect(usedAnswers({ ...other, fields: app1.fields })).toEqual({});
    const gate = checkOutbound({
      draft: { channel: 'web_form', address: URL_, body: 'x', caseId: CASE, approvedAt: NOW.toISOString(),
        webForm: { formFingerprint: 'f1-x', fields: app1.fields, uploads: [], hasFreeText: false } },
      caseRecord: record, consent: { sharedFields: ['diseaseName'], formAnswers: usedAnswers(other) }, contacts: [],
      allowlist: [], webAllowlist: ['localhost:3000'], now: NOW.toISOString(), mode: 'dev',
    });
    expect(gate).toMatchObject({ ok: false, reasons: expect.arrayContaining(['unshared_field']) });

    // Emails are written from the case record and ticked fields only.
    const email = createDraft(
      { id: 'contact-1', caseId: CASE, displayName: 'Demo clinic', channel: 'email', address: 'coord@agentmail.to', state: 'drafted' } as never,
      { contactId: 'contact-1', sharedFields: ['diseaseName'] } as never, record,
    );
    const text = JSON.stringify(email);
    for (const v of Object.values(GOOD)) expect(text).not.toContain(v);
  });

  it('pre-fills from the profile (labelled), never a non-birth date, and from the synthetic demo patient', async () => {
    const store = new MemoryApplicationStore();
    await store.save({ ...draft('app-1'), missing: [...draft('app-1').missing, q('onset', 'Date symptoms started', 'date', false)] });
    const profile = identityFromAccount({ legalName: 'Sam Q Patient', dateOfBirth: '1985-05-05', email: 'sam@example.test' });
    const res = await getAnswerQuestions(CASE, 'app-1', answerDeps(store, async () => ({ profile, origin: 'profile' })));
    if (!res.ok) throw new Error('expected ok');
    const by = Object.fromEntries(res.questions.map(x => [x.fieldKey, x.suggestion]));
    expect(by.first_name).toEqual({ value: 'Sam', origin: 'profile' });
    expect(by.last_name).toEqual({ value: 'Patient', origin: 'profile' });
    expect(by.date_of_birth).toEqual({ value: '1985-05-05', origin: 'profile' });
    expect(by.email).toEqual({ value: 'sam@example.test', origin: 'profile' });
    expect(by.onset).toBeNull();
    expect(res.questions.some(x => x.fieldKey === 'meds')).toBe(false);

    const demo = await getAnswerQuestions(CASE, 'app-1', answerDeps(store, async () => ({ profile: { ...DEMO_PATIENT_PROFILE }, origin: 'demo' })));
    if (!demo.ok) throw new Error('expected ok');
    expect(demo.questions.find(x => x.fieldKey === 'email')?.suggestion).toEqual({ value: 'ronit-1977@agentmail.to', origin: 'demo' });
  });
});
