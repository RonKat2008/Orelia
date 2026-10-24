import { describe, expect, it } from 'vitest';
import { ConsultError } from '@/lib/coordination/consult/service';
import { hashReviewToken } from '@/lib/coordination/consult/token';
import { consultTextHash } from '@/lib/safety/consult-gate';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import { CASE, DOCTOR_EMAIL, EXPERT_ADDRESS, harness, later, RESOURCE_KEY, resource, tokenFrom, TARGET, type Harness } from './consult-fixture';

async function drafted(h: Harness, sharedFields = ['diseaseName']) {
  const doctor = await h.svc.addDoctor(CASE, { name: 'Dr. Synthetic Lee', practice: 'Synthetic Family Practice', email: DOCTOR_EMAIL });
  const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, sharedFields });
  return { doctor, consult };
}

async function sentToDoctor(h: Harness) {
  const { doctor, consult } = await drafted(h);
  const c = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'send_to_doctor' });
  return { doctor, consult: c, token: tokenFrom(h.mailer.sent.at(-1)!.body) };
}

async function approved(h: Harness, edit?: (body: string) => string) {
  const s = await sentToDoctor(h);
  later(h, 60);
  const view = (await h.svc.reviewView(s.token))!;
  const { review } = await h.svc.reviewDecide(s.token, { decision: 'approve', subject: view.subject, body: edit ? edit(view.body) : view.body });
  const consult = (await h.store.get(CASE, 'consult', s.consult.id))!;
  return { ...s, review, consult };
}

const reject = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof ConsultError) return e; throw e; } throw new Error('expected refusal'); };

describe('consult service: happy path with the mock mailer', () => {
  it('draft -> review link -> doctor approves (edited) -> patient consents -> gated send -> tracked', async () => {
    const h = harness();
    const { consult } = await drafted(h);
    expect(consult.status).toBe('drafted');
    expect(consult.process.kind).toBe('econsult');
    expect(h.mailer.sent).toHaveLength(0);

    const s = await h.svc.patch(CASE, consult.id, { version: 1, action: 'send_to_doctor' });
    expect(s.status).toBe('sent_to_doctor');
    expect(s.reviewTokenHash).toBeNull(); // stripped for the client
    const mail = h.mailer.sent[0];
    expect(mail.to).toBe(DOCTOR_EMAIL);
    expect(mail.body).toContain('https://app.example.org/review/');
    expect(mail.body).toContain(AI_DISCLOSURE_EMAIL);
    expect(mail.body).not.toContain('Synthetic Rare Disease');
    const token = tokenFrom(mail.body);
    const stored = (await h.store.get(CASE, 'consult', consult.id))!;
    expect(stored.reviewTokenHash).toBe(hashReviewToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    later(h, 30);
    const view = (await h.svc.reviewView(token))!;
    const edited = view.body.replace('Could you let me know', 'Would you recommend surgery or radiation, and could you let me know');
    const { review } = await h.svc.reviewDecide(token, { decision: 'approve', subject: view.subject, body: edited });
    expect(review.status).toBe('doctor_approved');
    const appr = (await h.store.get(CASE, 'consult', consult.id))!;
    expect(appr.doctorEdited).toBe(true);
    expect(appr.approvedBodyHash).toBe(consultTextHash(appr.subject, appr.body));

    later(h, 30);
    const ready = await h.svc.patch(CASE, consult.id, { version: appr.version, action: 'consent' });
    expect(ready.status).toBe('ready');
    later(h, 1);
    const sent = await h.svc.patch(CASE, consult.id, { version: ready.version, action: 'send' });
    expect(sent.status).toBe('sent');
    expect(sent.providerMessageId).toMatch(/^mock-message-/);
    const out = h.mailer.sent[1];
    expect(out.to).toBe(EXPERT_ADDRESS);
    expect(out.body).toBe(appr.body);
    expect(out.approvedAt).toBe(ready.patientConsentAt);
    expect(h.tracker.sent).toHaveLength(1);
    expect(await h.tracker.contacts(CASE)).toEqual([expect.objectContaining({ targetId: TARGET, address: EXPERT_ADDRESS, state: 'sent' })]);
    // Sent twice? No.
    expect((await reject(h.svc.patch(CASE, consult.id, { version: sent.version, action: 'send' }))).reasons).toEqual(['consult_not_ready']);
  });
});

describe('consult service: refusals', () => {
  it('cannot send or consent before the doctor approved', async () => {
    const h = harness();
    const { consult } = await sentToDoctor(h);
    expect((await reject(h.svc.patch(CASE, consult.id, { version: consult.version, action: 'consent' }))).status).toBe(409);
    expect((await reject(h.svc.patch(CASE, consult.id, { version: consult.version, action: 'send' }))).reasons).toEqual(['consult_not_ready']);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('text changed after the doctor approved is refused at send', async () => {
    const h = harness();
    const { consult } = await approved(h);
    later(h, 5);
    const ready = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'consent' });
    const tampered = (await h.store.get(CASE, 'consult', consult.id))!;
    await h.store.save(CASE, 'consult', consult.id, { ...tampered, body: `${tampered.body}\nextra`, version: tampered.version + 1 }, tampered.version);
    const e = await reject(h.svc.patch(CASE, consult.id, { version: ready.version + 1, action: 'send' }));
    expect(e.status).toBe(422);
    expect(e.reasons).toContain('text_changed_after_approval');
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('no evidence-backed expert address: reviewable, but send refused with no_expert_address', async () => {
    const h = harness();
    h.inputs.list = [resource([{ id: 'ev-page', claimType: 'page_excerpt', claim: 'We offer e-consults. Write to referrals@expert-center.example.org.', sourceUrl: 'https://expert-center.example.org/physicians', sourceKind: 'exa' } as never])];
    const { consult } = await approved(h);
    expect(consult.process.expertAddress).toBeNull();
    later(h, 5);
    const ready = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'consent' });
    const e = await reject(h.svc.patch(CASE, consult.id, { version: ready.version, action: 'send' }));
    expect(e.reasons).toContain('no_expert_address');
    expect((await h.store.get(CASE, 'consult', consult.id))!.failureReasons).toContain('no_expert_address');
  });

  it('expert not allowlisted is refused', async () => {
    const h = harness();
    const { consult } = await approved(h);
    h.deps.env = { ...h.deps.env, OUTBOUND_ALLOWLIST: DOCTOR_EMAIL };
    later(h, 5);
    const ready = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'consent' });
    expect((await reject(h.svc.patch(CASE, consult.id, { version: ready.version, action: 'send' }))).reasons).toContain('not_allowlisted');
  });

  it('review link to a non-allowlisted doctor is refused and nothing is stored', async () => {
    const h = harness();
    const doctor = await h.svc.addDoctor(CASE, { name: 'Dr. Other', email: 'dr.other@clinic.example.org' });
    const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, sharedFields: [] });
    const e = await reject(h.svc.patch(CASE, consult.id, { version: 1, action: 'send_to_doctor' }));
    expect(e.reasons).toEqual(['not_allowlisted']);
    expect((await h.store.get(CASE, 'consult', consult.id))!.reviewTokenHash).toBeNull();
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('doctor edit adding an unshared patient detail is refused; removing the disclosure re-appends it', async () => {
    const h = harness();
    const { token } = await sentToDoctor(h);
    const view = (await h.svc.reviewView(token))!;
    const e = await reject(h.svc.reviewDecide(token, { decision: 'approve', subject: view.subject, body: `${view.body}\nInsurer: Fictional Health Co` }));
    expect(e.status).toBe(422);
    expect(e.reasons).toEqual(['unshared_field']);
    const r = await h.svc.reviewDecide(token, { decision: 'approve', subject: view.subject, body: view.body.replace(AI_DISCLOSURE_EMAIL, '') });
    expect(r.footerAdded).toBe(true);
    expect(r.review.body).toContain(AI_DISCLOSURE_EMAIL);
  });

  it('a decision is allowed once; then GET is the generic not-found and POST is 409', async () => {
    const h = harness();
    const { token } = await approved(h);
    expect(await h.svc.reviewView(token)).toBeNull();
    expect((await reject(h.svc.reviewDecide(token, { decision: 'decline' }))).status).toBe(409);
  });

  it('decline records the note and blocks consent', async () => {
    const h = harness();
    const { token, consult } = await sentToDoctor(h);
    const { review } = await h.svc.reviewDecide(token, { decision: 'decline', note: 'Please book a visit first.' });
    expect(review.status).toBe('doctor_declined');
    const c = (await h.store.get(CASE, 'consult', consult.id))!;
    expect(c.doctorNote).toBe('Please book a visit first.');
    expect((await reject(h.svc.patch(CASE, c.id, { version: c.version, action: 'consent' }))).status).toBe(409);
  });

  it('expired, forged, unknown, cancelled and superseded links are all not found', async () => {
    const h = harness();
    const { token, consult } = await sentToDoctor(h);
    expect(await h.svc.reviewView('nope')).toBeNull();
    expect(await h.svc.reviewView(token.replace(/^./, c => (c === 'A' ? 'B' : 'A')))).toBeNull();
    // Re-sending rotates the token: the old link dies.
    const resent = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'send_to_doctor' });
    const fresh = tokenFrom(h.mailer.sent.at(-1)!.body);
    expect(await h.svc.reviewView(token)).toBeNull();
    expect(await h.svc.reviewView(fresh)).not.toBeNull();
    later(h, 14 * 24 * 60 + 1);
    expect(await h.svc.reviewView(fresh)).toBeNull();
    expect((await reject(h.svc.reviewDecide(fresh, { decision: 'decline' }))).status).toBe(404);
    const h2 = harness();
    const s2 = await sentToDoctor(h2);
    await h2.svc.patch(CASE, s2.consult.id, { version: s2.consult.version, action: 'cancel' });
    expect(await h2.svc.reviewView(s2.token)).toBeNull();
    expect(resent.status).toBe('sent_to_doctor');
  });

  it('the review view contains the request only', async () => {
    const h = harness();
    const { token } = await sentToDoctor(h);
    const view = (await h.svc.reviewView(token))!;
    expect(Object.keys(view).sort()).toEqual(['body', 'doctorName', 'expertName', 'expiresAt', 'packet', 'processDetail', 'processKind', 'processSourceUrl', 'status', 'subject']);
    const json = JSON.stringify(view);
    for (const secret of ['Fictional Health', 'Springfield', DOCTOR_EMAIL, CASE, 'reviewTokenHash', EXPERT_ADDRESS]) expect(json).not.toContain(secret);
  });

  it('edits only while drafted, re-check advice and unshared fields; version conflicts are 409', async () => {
    const h = harness();
    const { consult } = await drafted(h);
    expect((await reject(h.svc.patch(CASE, consult.id, { version: 1, action: 'edit', subject: 'S', body: 'You should start chemotherapy.' }))).reasons).toContain('medical_advice');
    expect((await reject(h.svc.patch(CASE, consult.id, { version: 1, action: 'edit', subject: 'S', body: 'Lives in Springfield.' }))).reasons).toContain('unshared_field');
    const ok = await h.svc.patch(CASE, consult.id, { version: 1, action: 'edit', subject: 'Consult request', body: 'Dear colleagues, could you review this case?' });
    expect(ok.body).toContain(AI_DISCLOSURE_EMAIL);
    expect((await reject(h.svc.patch(CASE, consult.id, { version: 1, action: 'cancel' }))).status).toBe(409);
  });

  it('doctor deletion is refused while an active consult uses them', async () => {
    const h = harness();
    const { doctor, consult } = await drafted(h);
    expect((await reject(h.svc.removeDoctor(CASE, doctor.id))).status).toBe(409);
    await h.svc.patch(CASE, consult.id, { version: 1, action: 'cancel' });
    await h.svc.removeDoctor(CASE, doctor.id);
    expect(await h.svc.listDoctors(CASE)).toEqual([]);
  });

  it('a sixth resource is refused by the cap at send', async () => {
    const h = harness();
    for (const t of ['a', 'b', 'c', 'd', 'e']) h.tracker.rows.push({ id: t, caseId: CASE, targetId: `other-${t}`, address: `intake@${t}.example.org`, state: 'sent' });
    const { consult } = await approved(h);
    later(h, 5);
    const ready = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'consent' });
    expect((await reject(h.svc.patch(CASE, consult.id, { version: ready.version, action: 'send' }))).reasons).toContain('contact_cap');
  });

  it('a failed expert send is marked failed and never retried automatically', async () => {
    const h = harness();
    const { consult } = await approved(h);
    later(h, 5);
    const ready = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'consent' });
    h.deps.email = () => ({ send: async () => { throw new Error('provider down'); } });
    expect((await reject(h.svc.patch(CASE, consult.id, { version: ready.version, action: 'send' }))).status).toBe(502);
    expect((await h.store.get(CASE, 'consult', consult.id))!.status).toBe('failed');
  });
});
