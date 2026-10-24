import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConsultError } from '@/lib/coordination/consult/service';
import { isFreeMailAddress } from '@/lib/safety/free-mail';
import { consultTextHash } from '@/lib/safety/consult-gate';
import { CASE, DOCTOR_EMAIL, DOCTOR_NPI, EXPERT_ADDRESS, harness, later, PATIENT_EMAIL, RESOURCE_KEY, tokenFrom, type Harness } from './consult-fixture';

/**
 * Security review fixes for feat/rd-coordinate (scratchpad briefs/review-coordinate.md, findings #1-#8).
 */

const CLINICAL = 'Would you recommend surgery or radiation for this patient?';
const AUDIT = { ip: '203.0.113.50', userAgent: 'Synthetic Browser/1.0' };

const reject = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof ConsultError) return e; throw e; } throw new Error('expected refusal'); };

async function addVerified(h: Harness, over: { email?: string; npi?: string; name?: string } = {}) {
  return h.svc.addDoctor(CASE, { name: over.name ?? 'Dr. Synthetic Lee', practice: 'Synthetic Family Practice', email: over.email ?? DOCTOR_EMAIL, npi: over.npi ?? DOCTOR_NPI });
}

async function toDoctor(h: Harness, doctorId: string) {
  const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId, sharedFields: ['diseaseName'] });
  const c = await h.svc.patch(CASE, consult.id, { version: consult.version, action: 'send_to_doctor' });
  return { consult: c, token: tokenFrom(h.mailer.sent.at(-1)!.body) };
}

async function approveWith(h: Harness, doctorId: string, edit: (body: string) => string = b => b) {
  const s = await toDoctor(h, doctorId);
  later(h, 30);
  const view = (await h.svc.reviewView(s.token))!;
  await h.svc.reviewDecide(s.token, { decision: 'approve', subject: view.subject, body: edit(view.body) }, AUDIT);
  later(h, 5);
  const approved = (await h.store.get(CASE, 'consult', s.consult.id))!;
  const ready = await h.svc.patch(CASE, approved.id, { version: approved.version, action: 'consent' });
  return { ...s, view, ready };
}

const addClinical = (body: string) => body.replace('Could you let me know', `${CLINICAL}\n\nCould you let me know`);

describe('#1 self-approval: doctor email rules', () => {
  it.each([
    ['the patient\'s own email', PATIENT_EMAIL.toUpperCase()],
    ['the AgentMail sender inbox', 'wayfinder-sender@agentmail.to'],
    ['any AgentMail inbox', 'someone@agentmail.to'],
    ['a demo coordinator inbox', 'coordinator@demo.example.org'],
  ])('refuses %s as the doctor email', async (_label, email) => {
    const h = harness();
    h.deps.env = { ...h.deps.env, AGENTMAIL_SENDER_INBOX_ID: 'wayfinder-sender@agentmail.to', DEMO_COORDINATOR_INBOXES: 'coordinator@demo.example.org' };
    const e = await reject(h.svc.addDoctor(CASE, { name: 'Dr. Synthetic Lee', email }));
    expect(e.status).toBe(422);
    expect(e.reasons).toEqual(['doctor_email_not_allowed']);
    expect(await h.svc.listDoctors(CASE)).toEqual([]);
  });

  it('re-checks the doctor email when the review link is sent (patient email changed later)', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    h.deps.patientEmail = async () => DOCTOR_EMAIL;
    const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, sharedFields: [] });
    const e = await reject(h.svc.patch(CASE, consult.id, { version: 1, action: 'send_to_doctor' }));
    expect(e.reasons).toEqual(['doctor_email_not_allowed']);
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe('#1 self-approval: verified doctors only get the exemption', () => {
  it('a doctor whose NPI matches their name at a practice domain is verified', async () => {
    const h = harness();
    const d = await addVerified(h);
    expect(d).toMatchObject({ npi: DOCTOR_NPI, verified: true, verificationReason: 'verified' });
  });

  it.each([
    ['no NPI', { npi: '' }, 'npi_missing'],
    ['a free-mail address', { email: 'dr.lee@gmail.com' }, 'free_mail_domain'],
    ['an NPI that is not this doctor', { npi: '1987654321' }, 'npi_name_mismatch'],
    ['a name the registry does not list', { name: 'Dr. Someone Else' }, 'npi_name_mismatch'],
  ])('is not verified with %s', async (_l, over, reason) => {
    const h = harness();
    const d = await addVerified(h, over);
    expect(d.verified).toBe(false);
    expect(d.verificationReason).toBe(reason);
  });

  it('registry errors leave the doctor unverified (never verified by default)', async () => {
    const h = harness({ verifier: { verify: async () => { throw new Error('registry down'); } } });
    const d = await addVerified(h);
    expect(d).toMatchObject({ verified: false, verificationReason: 'registry_unavailable' });
  });

  it('free-mail list covers the common providers', () => {
    for (const d of ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'mail.com', 'zoho.com']) {
      expect(isFreeMailAddress(`dr@${d}`)).toBe(true);
    }
    expect(isFreeMailAddress('dr@clinic.example.org')).toBe(false);
  });

  it('verified doctor: a clinical question passes (exemption); the message names the doctor email and NPI', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id, addClinical);
    const sent = await h.svc.patch(CASE, ready.id, { version: ready.version, action: 'send' });
    expect(sent.status).toBe('sent');
    const out = h.mailer.sent.at(-1)!;
    expect(out.to).toBe(EXPERT_ADDRESS);
    expect(out.body).toContain(CLINICAL);
    expect(out.body).toContain(DOCTOR_EMAIL);
    expect(out.body).toContain(`NPI ${DOCTOR_NPI}`);
  });

  it('unverified doctor: the same clinical question goes through the standard filter and is refused', async () => {
    const h = harness();
    const doctor = await addVerified(h, { npi: '' });
    const { ready } = await approveWith(h, doctor.id, addClinical);
    const e = await reject(h.svc.patch(CASE, ready.id, { version: ready.version, action: 'send' }));
    expect(e.reasons).toContain('medical_advice');
    expect(h.mailer.sent.at(-1)!.to).toBe(DOCTOR_EMAIL);
  });

  it('records approval time and sha256(ip + user agent) for audit', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id);
    const stored = (await h.store.get(CASE, 'consult', ready.id))!;
    expect(stored.doctorApprovedAt).toEqual(expect.any(String));
    expect(stored.doctorApprovalAudit).toBe(createHash('sha256').update(JSON.stringify([AUDIT.ip, AUDIT.userAgent]), 'utf8').digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(AUDIT.ip);
    expect(stored.approvedBy).toEqual({ email: DOCTOR_EMAIL, npi: DOCTOR_NPI, verified: true });
  });

  it('the review page says whether the doctor is verified', async () => {
    const h = harness();
    const verified = await addVerified(h);
    const a = await toDoctor(h, verified.id);
    expect((await h.svc.reviewView(a.token))!.doctorVerified).toBe(true);
  });
});

describe('#2 review-link relay limits', () => {
  it('send_to_doctor: max 3 per consult per day', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    let c = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, sharedFields: [] });
    for (let i = 0; i < 3; i++) c = await h.svc.patch(CASE, c.id, { version: c.version, action: 'send_to_doctor' });
    const e = await reject(h.svc.patch(CASE, c.id, { version: c.version, action: 'send_to_doctor' }));
    expect(e.status).toBe(429);
    expect(e.reasons).toEqual(['rate_limited']);
    expect(h.mailer.sent).toHaveLength(3);
    later(h, 24 * 60 + 1);
    expect((await h.svc.patch(CASE, c.id, { version: c.version, action: 'send_to_doctor' })).status).toBe('sent_to_doctor');
  });

  it('send_to_doctor: max 10 per case per day', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    let sent = 0;
    let refused: ConsultError | null = null;
    for (let k = 0; k < 4 && !refused; k++) {
      let c = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, sharedFields: [] });
      for (let i = 0; i < 3 && !refused; i++) {
        try { c = await h.svc.patch(CASE, c.id, { version: c.version, action: 'send_to_doctor' }); sent++; } catch (e) { refused = e as ConsultError; }
      }
    }
    expect(sent).toBe(10);
    expect(refused?.status).toBe(429);
  });

  it('at most 5 doctors per case', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await h.svc.addDoctor(CASE, { name: `Dr. Synthetic ${i}`, email: `dr${i}@clinic.example.org` });
    const e = await reject(h.svc.addDoctor(CASE, { name: 'Dr. Six', email: 'dr6@clinic.example.org' }));
    expect(e.status).toBe(409);
  });

  it.each([
    ['too long', 'Dr. ' + 'a'.repeat(120)],
    ['a URL', 'Dr. Lee https://evil.example.net/login'],
    ['a bare domain', 'Dr. Lee evil-login.com'],
    ['www', 'Dr. Lee www.evil.example'],
  ])('doctor name with %s is refused', async (_l, name) => {
    const h = harness();
    expect((await reject(h.svc.addDoctor(CASE, { name, email: DOCTOR_EMAIL }))).status).toBe(400);
  });

  it('ordinary names with initials and credentials are accepted', async () => {
    const h = harness();
    expect((await h.svc.addDoctor(CASE, { name: 'Dr. J. R. Synthetic-Lee, M.D.', email: DOCTOR_EMAIL })).name).toBe('Dr. J. R. Synthetic-Lee, M.D.');
  });
});

describe('#3 the doctor sees and approves the destination address', () => {
  it('review view shows the expert address; the approved hash covers {to, subject, body}', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { token, consult } = await toDoctor(h, doctor.id);
    const view = (await h.svc.reviewView(token))!;
    expect(view.expertAddress).toBe(EXPERT_ADDRESS);
    await h.svc.reviewDecide(token, { decision: 'approve', subject: view.subject, body: view.body }, AUDIT);
    const c = (await h.store.get(CASE, 'consult', consult.id))!;
    expect(c.approvedBodyHash).toBe(consultTextHash({ to: EXPERT_ADDRESS, subject: c.subject, body: c.body }));
    expect(c.approvedBodyHash).not.toBe(consultTextHash({ to: 'other@expert-center.example.org', subject: c.subject, body: c.body }));
  });

  it('an address changed after approval is refused at send', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id);
    const cur = (await h.store.get(CASE, 'consult', ready.id))!;
    h.inputs.list = [{ ...h.inputs.list[0], evidence: [{ id: 'ev-cp', claimType: 'contact_point.email.referral_coordinator', claim: 'other@expert-center.example.org', sourceUrl: 'https://expert-center.example.org/refer', sourceKind: 'exa' }] } as never];
    await h.store.save(CASE, 'consult', cur.id, { ...cur, process: { ...cur.process, expertAddress: 'other@expert-center.example.org' }, version: cur.version + 1 }, cur.version);
    const e = await reject(h.svc.patch(CASE, cur.id, { version: cur.version + 1, action: 'send' }));
    expect(e.reasons).toEqual(expect.arrayContaining(['approval_not_verified']));
  });
});

describe('#4 approval HMAC is verified before the gate', () => {
  it('a consult forged into "ready" with a self-consistent hash but no approval MAC is refused', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const consult = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, sharedFields: ['diseaseName'] });
    const c = (await h.store.get(CASE, 'consult', consult.id))!;
    const t = h.clock.t.toISOString();
    await h.store.save(CASE, 'consult', c.id, {
      ...c, status: 'ready', doctorApprovedAt: t, patientConsentAt: t, approvedBodyHash: consultTextHash({ to: EXPERT_ADDRESS, subject: c.subject, body: c.body }),
      approvedBy: { email: DOCTOR_EMAIL, npi: DOCTOR_NPI, verified: true }, version: 2,
    }, 1);
    later(h, 1);
    const e = await reject(h.svc.patch(CASE, c.id, { version: 2, action: 'send' }));
    expect(e.reasons).toEqual(['approval_not_verified']);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('a tampered approval MAC is refused', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id);
    const cur = (await h.store.get(CASE, 'consult', ready.id))!;
    await h.store.save(CASE, 'consult', cur.id, { ...cur, approvedBy: { ...cur.approvedBy!, email: 'someone@clinic.example.org' }, version: cur.version + 1 }, cur.version);
    const e = await reject(h.svc.patch(CASE, cur.id, { version: cur.version + 1, action: 'send' }));
    expect(e.reasons).toEqual(['approval_not_verified']);
  });
});

describe('#5 control characters and hash framing', () => {
  it('subject with CR/LF or body with control characters is refused at decision time', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { token } = await toDoctor(h, doctor.id);
    const view = (await h.svc.reviewView(token))!;
    expect((await reject(h.svc.reviewDecide(token, { decision: 'approve', subject: 'Hi\r\nBcc: x@evil.example.net', body: view.body }, AUDIT))).status).toBe(400);
    expect((await reject(h.svc.reviewDecide(token, { decision: 'approve', subject: view.subject, body: `${view.body}\u0007` }, AUDIT))).status).toBe(400);
  });

  it('patient edit with a control character in the subject is refused', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const c = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, sharedFields: [] });
    expect((await reject(h.svc.patch(CASE, c.id, { version: 1, action: 'edit', subject: 'A\nB', body: 'Dear colleagues.' }))).status).toBe(400);
  });

  it('the hash is unambiguous: moving a newline between subject and body changes it', () => {
    expect(consultTextHash({ to: 'a@x.org', subject: 'a\nb', body: 'c' })).not.toBe(consultTextHash({ to: 'a@x.org', subject: 'a', body: 'b\nc' }));
  });
});

describe('#7 consult sends update follow-up cadence', () => {
  it('an existing emailed contact at the same address counts the consult as a follow-up', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id);
    const firstSentAt = '2026-10-01T10:00:00.000Z';
    h.tracker.rows.push({ id: 'c1', caseId: CASE, targetId: ready.resourceKey.split(':')[1], address: EXPERT_ADDRESS, state: 'sent', lastSentAt: firstSentAt, followUpsSent: 0 });
    await h.svc.patch(CASE, ready.id, { version: ready.version, action: 'send' });
    expect(h.tracker.rows[0]).toMatchObject({ lastSentAt: firstSentAt, followUpsSent: 1 });
  });

  it('a drafted contact at the same address gets its first-sent time', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id);
    h.tracker.rows.push({ id: 'c1', caseId: CASE, targetId: ready.resourceKey.split(':')[1], address: EXPERT_ADDRESS, state: 'drafted', lastSentAt: null, followUpsSent: 0 });
    const sent = await h.svc.patch(CASE, ready.id, { version: ready.version, action: 'send' });
    expect(h.tracker.rows[0]).toMatchObject({ state: 'sent', lastSentAt: sent.sentAt, followUpsSent: 0 });
  });

  it('the consult record and the tracker write commit together (a lost CAS writes nothing)', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id);
    const ok = await h.tracker.recordSent(
      { consult: { ...ready, status: 'sent', version: ready.version + 1 }, targetKind: 'expert', targetId: 'x', address: EXPERT_ADDRESS, sentAt: h.clock.t.toISOString(), providerMessageId: null, providerThreadId: null },
      { store: h.store, expectedVersion: ready.version + 7 },
    );
    expect(ok).toBe(false);
    expect(h.tracker.rows).toEqual([]);
    expect(h.tracker.sent).toEqual([]);
  });
});

describe('#8 the review page shows the packet snapshot in the message', () => {
  it('re-ticking packet sections after drafting does not change what the doctor sees', async () => {
    const h = harness();
    const doctor = await addVerified(h);
    const now = h.clock.t.toISOString();
    const packet = {
      id: '44444444-4444-4444-8444-444444444444', caseId: CASE, resourceKey: RESOURCE_KEY, name: 'Synthetic Expert Center', historySource: 'fixture' as const,
      version: 1, createdAt: now, updatedAt: now,
      sections: [
        { key: 'summary' as const, title: 'Summary', included: true, items: [{ text: 'Synthetic summary line.', date: null, sourceDocId: null, sourceUrl: null }] },
        { key: 'questions' as const, title: 'Questions', included: false, items: [{ text: 'Synthetic question.', date: null, sourceDocId: null, sourceUrl: null }] },
      ],
    };
    await h.store.save(CASE, 'packet', RESOURCE_KEY, packet);
    const c = await h.svc.create(CASE, { resourceKey: RESOURCE_KEY, doctorId: doctor.id, packetId: packet.id, sharedFields: [] });
    await h.store.save(CASE, 'packet', RESOURCE_KEY, { ...packet, version: 2, sections: packet.sections.map(s => ({ ...s, included: !s.included })) }, 1);
    await h.svc.patch(CASE, c.id, { version: 1, action: 'send_to_doctor' });
    const view = (await h.svc.reviewView(tokenFrom(h.mailer.sent.at(-1)!.body)))!;
    expect(view.packet?.map(s => s.key)).toEqual(['summary']);
  });
});

describe('#7 Postgres tracker: one atomic statement', () => {
  it('consult CAS, contact upsert (cadence) and message insert go in a single statement with bound params', async () => {
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const { PostgresConsultTracker } = await import('@/lib/coordination/consult/tracker');
    const { PostgresCoordinationStore } = await import('@/lib/coordination/store');
    const queries: { sql: string; params: unknown[] }[] = [];
    let committed = 1;
    const db = { execute: async (q: import('drizzle-orm').SQL) => { queries.push(new PgDialect().sqlToQuery(q)); return { rows: [{ committed, messages: committed }] }; } };
    const tracker = new PostgresConsultTracker(db as never);
    const h = harness();
    const doctor = await addVerified(h);
    const { ready } = await approveWith(h, doctor.id);
    const record = { consult: { ...ready, sharedFields: ['diseaseName', "x'); DROP TABLE contacts; --"] }, targetKind: 'expert' as const, targetId: ready.resourceKey.split(':')[1], address: EXPERT_ADDRESS, sentAt: h.clock.t.toISOString(), providerMessageId: 'm1', providerThreadId: null };
    expect(await tracker.recordSent(record, { store: new PostgresCoordinationStore(), expectedVersion: 3 })).toBe(true);
    expect(queries).toHaveLength(1);
    const q = queries[0].sql;
    for (const part of ['UPDATE coordination_records', 'INSERT INTO contacts', 'INSERT INTO messages', 'COALESCE(first_sent_at', 'follow_ups_sent + CASE WHEN first_sent_at IS NOT NULL THEN 1 ELSE 0 END']) expect(q).toContain(part);
    expect(q).not.toContain('DROP TABLE');
    expect(queries[0].params).toContain("x'); DROP TABLE contacts; --");
    committed = 0;
    expect(await tracker.recordSent(record, { store: new PostgresCoordinationStore(), expectedVersion: 3 })).toBe(false);
  });
});

describe('#1 doctor name parsing for the NPPES lookup', () => {
  it.each([
    ['Dr. Synthetic Lee', { first: 'Synthetic', last: 'Lee' }],
    ['Dr. Jane Q. Synthetic-Lee, MD', { first: 'Jane', last: 'Synthetic-Lee' }],
    ['Jane Doe M.D. PhD', { first: 'Jane', last: 'Doe' }],
    ['Dr. Lee', null],
  ])('%s', async (name, expected) => {
    const { splitDoctorName } = await import('@/lib/coordination/consult/doctor-verify');
    expect(splitDoctorName(name)).toEqual(expected);
  });
});
