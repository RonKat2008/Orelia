import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', async () => {
  const { fakeDb } = await import('../helpers/db/fake-chain-db');
  return { getDb: () => fakeDb };
});

import { fakeDb } from '../helpers/db/fake-chain-db';
import {
  getFollowUpPlan, MemoryFollowUpPlan, PostgresFollowUpPlan, resolvePreapprovedSend, setFollowUpPlanForTests,
  type ContactPlanInput, type FollowUpPlan,
} from '../../lib/outreach/follow-up-plan';
import { approvalFingerprint, canonicalFollowUp, type CaseSnapshot } from '../../lib/outreach/preapprove';

const CONSENT_AT = '2026-10-20T10:00:00.000Z';
const APPROVED_AT = new Date('2026-10-21T10:00:00.000Z');
const POLICY = { mode: 'dev' as const, allowlist: ['patient@example.com'] };
const snapshot: CaseSnapshot = {
  diseaseName: 'fictional rare disease', diseaseCodes: null, subtype: null, stageSummary: null, homeCity: 'Springfield',
  homeState: 'IL', insurer: null, planId: null, travelLimitMiles: 100, goals: ['second opinion'],
};
const input = (over: Partial<ContactPlanInput> = {}): ContactPlanInput => ({
  contactId: 'c1', caseId: 'case1', channel: 'email', contactState: 'sent', sharedFields: ['diseaseName'],
  consentApprovedAt: CONSENT_AT, snapshot, ...over,
});

describe('MemoryFollowUpPlan', () => {
  it('refuses to pre-approve without a consent timestamp', async () => {
    const plan = new MemoryFollowUpPlan();
    await expect(plan.approve({ ...input({ consentApprovedAt: null }), approvedAt: APPROVED_AT })).rejects.toThrow(/Consent must be approved/);
    expect(plan.items).toHaveLength(0);
  });

  it('creates both follow-ups, and a second approve reuses the same message ids', async () => {
    const plan = new MemoryFollowUpPlan();
    const first = await plan.approve({ ...input(), approvedAt: APPROVED_AT });
    const again = await plan.approve({ ...input({ sharedFields: ['diseaseName', 'insurer'] }), approvedAt: APPROVED_AT });
    expect(first.map((i) => i.classification)).toEqual(['follow_up_1', 'follow_up_2']);
    expect(again.map((i) => i.messageId)).toEqual(first.map((i) => i.messageId));
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0].sharedFields).toEqual(['diseaseName', 'insurer']);
  });

  it('keeps an already-sent follow-up untouched when re-approving', async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({ ...input(), approvedAt: APPROVED_AT });
    plan.items[0].sentAt = '2026-10-25T10:00:00.000Z';
    const again = await plan.approve({ ...input({ sharedFields: ['insurer'] }), approvedAt: APPROVED_AT });
    expect(again[0].sentAt).toBe('2026-10-25T10:00:00.000Z');
    expect(plan.items[0].sharedFields).toEqual(['diseaseName']);
    expect(plan.items[1].sharedFields).toEqual(['insurer']);
  });

  it('lists only the follow-ups of the requested case and falls back to empty notification settings', async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({ ...input(), approvedAt: APPROVED_AT });
    await plan.approve({ ...input({ contactId: 'c2', caseId: 'case2' }), approvedAt: APPROVED_AT });
    const listed = await plan.list('case1');
    expect(listed.followUps.every((f) => f.contactId === 'c1')).toBe(true);
    expect(listed.notification).toEqual({ patientEmail: null, optIn: false, homeState: null, lastSentAt: null, lastDigestOn: null });
  });

  it('revoke clears only unsent approvals', async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({ ...input(), approvedAt: APPROVED_AT });
    plan.items[0].sentAt = '2026-10-25T10:00:00.000Z';
    expect(await plan.revoke('c1')).toEqual({ revoked: 1 });
    expect(plan.items[0].approvedAt).not.toBeNull();
    expect(plan.items[1].approvedAt).toBeNull();
    expect(await plan.cancelPending('c1', 'reply')).toEqual({ revoked: 0 });
  });

  it('getMessage and contextFor return null for unknown contacts', async () => {
    const plan = new MemoryFollowUpPlan();
    expect(await plan.getMessage('nobody', 1)).toBeNull();
    expect(await plan.contextFor('nobody')).toBeNull();
  });

  it('contextFor reflects setContext patches and setContext rejects unknown contacts', async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({ ...input(), approvedAt: APPROVED_AT });
    plan.setContext('c1', { contactState: 'replied' });
    expect((await plan.contextFor('c1'))?.contactState).toBe('replied');
    expect(() => plan.setContext('ghost', {})).toThrow('unknown contact');
  });

  describe('saveNotification', () => {
    it('rejects an unparseable email', async () => {
      await expect(new MemoryFollowUpPlan().saveNotification('case1', { patientEmail: 'not-an-email', optIn: true }, POLICY)).rejects.toThrow('Invalid patient email');
    });
    it('rejects an opted-in email that is not allowlisted', async () => {
      await expect(new MemoryFollowUpPlan().saveNotification('case1', { patientEmail: 'stranger@example.net', optIn: true }, POLICY)).rejects.toThrow(/OUTBOUND_ALLOWLIST/);
    });
    it('accepts a non-allowlisted email when not opted in', async () => {
      const saved = await new MemoryFollowUpPlan().saveNotification('case1', { patientEmail: 'stranger@example.net', optIn: false }, POLICY);
      expect(saved.optIn).toBe(false);
    });
    it('skips the allowlist only in prod with explicit allow-real', async () => {
      const plan = new MemoryFollowUpPlan();
      const saved = await plan.saveNotification('case1', { patientEmail: 'anyone@example.net', optIn: true }, { mode: 'prod', allowlist: [], outboundAllowReal: 'true' });
      expect(saved.patientEmail).toBe('anyone@example.net');
      await expect(plan.saveNotification('case1', { patientEmail: 'anyone@example.net', optIn: true }, { mode: 'prod', allowlist: [] })).rejects.toThrow(/OUTBOUND_ALLOWLIST/);
    });
    it('stores a null email and preserves previously recorded send state', async () => {
      const plan = new MemoryFollowUpPlan();
      await plan.recordNotify('case1', { lastSentAt: '2026-10-22T00:00:00.000Z', lastDigestOn: '2026-10-22' });
      const saved = await plan.saveNotification('case1', { patientEmail: null, optIn: false }, POLICY);
      expect(saved).toMatchObject({ patientEmail: null, lastSentAt: '2026-10-22T00:00:00.000Z', lastDigestOn: '2026-10-22' });
    });
  });

  it('recordNotify merges onto existing settings', async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.saveNotification('case1', { patientEmail: 'patient@example.com', optIn: true }, POLICY);
    await plan.recordNotify('case1', { lastSentAt: '2026-10-22T00:00:00.000Z', lastDigestOn: null });
    expect(plan.notifications.get('case1')).toMatchObject({ patientEmail: 'patient@example.com', optIn: true, lastSentAt: '2026-10-22T00:00:00.000Z' });
  });
});

describe('resolvePreapprovedSend', () => {
  async function approved(over: Partial<ContactPlanInput> = {}) {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({ ...input(over), approvedAt: APPROVED_AT });
    return plan;
  }
  it('holds as not_preapproved when no row exists', async () => {
    expect(await resolvePreapprovedSend(new MemoryFollowUpPlan(), { contactId: 'c1', followUpNumber: 1 })).toEqual({ action: 'hold', reason: 'not_preapproved' });
  });
  it('holds as not_preapproved after the approval was revoked', async () => {
    const plan = await approved();
    await plan.revoke('c1');
    expect(await resolvePreapprovedSend(plan, { contactId: 'c1', followUpNumber: 1 })).toEqual({ action: 'hold', reason: 'not_preapproved' });
  });
  it('holds as missing_context when the contact context vanished', async () => {
    const plan = await approved();
    plan.contacts.delete('c1');
    expect(await resolvePreapprovedSend(plan, { contactId: 'c1', followUpNumber: 1 })).toEqual({ action: 'hold', reason: 'missing_context' });
  });
  it.each([['replied', 'reply'], ['declined', 'decline']] as const)('on %s it cancels pending follow-ups with reason %s', async (state, reason) => {
    const plan = await approved();
    plan.setContext('c1', { contactState: state });
    const spy = vi.spyOn(plan, 'cancelPending');
    expect(await resolvePreapprovedSend(plan, { contactId: 'c1', followUpNumber: 1 })).toEqual({ action: 'hold', reason: state });
    expect(spy).toHaveBeenCalledWith('c1', reason);
    expect(plan.items.every((i) => i.approvedAt === null)).toBe(true);
  });
  it('holds with the assessor reason when the case changed after approval', async () => {
    const plan = await approved();
    plan.setContext('c1', { snapshot: { ...snapshot, insurer: 'Fictional Plan' } });
    expect(await resolvePreapprovedSend(plan, { contactId: 'c1', followUpNumber: 2 })).toEqual({ action: 'hold', reason: 'case_changed' });
  });
  it('sends the stored canonical body when nothing changed', async () => {
    const plan = await approved();
    const out = await resolvePreapprovedSend(plan, { contactId: 'c1', followUpNumber: 1 });
    expect(out).toMatchObject({ action: 'send', body: canonicalFollowUp('email').body });
  });
});

describe('getFollowUpPlan / setFollowUpPlanForTests', () => {
  it('returns the injected plan, and a Postgres plan once cleared', () => {
    const injected: FollowUpPlan = new MemoryFollowUpPlan();
    setFollowUpPlanForTests(injected);
    expect(getFollowUpPlan()).toBe(injected);
    setFollowUpPlanForTests(null);
    expect(getFollowUpPlan()).toBeInstanceOf(PostgresFollowUpPlan);
  });
});

describe('PostgresFollowUpPlan', () => {
  beforeEach(() => fakeDb.reset());
  const plan = new PostgresFollowUpPlan();
  const message = (over: Record<string, unknown> = {}) => ({
    id: 'm1', contactId: 'c1', classification: 'follow_up_1', channel: 'email', body: 'b', subject: 's', sharedFields: ['diseaseName'],
    approvedAt: null, sentAt: null, approvalFingerprint: null, ...over,
  });
  const caseRow = (over: Record<string, unknown> = {}) => ({
    id: 'case1', patientEmail: 'patient@example.com', patientNotifyOptIn: true, homeState: 'IL', patientNotifyLastAt: null, patientNotifyDigestOn: null,
    diseaseName: 'fictional rare disease', diseaseCodes: null, subtype: null, stageSummary: null, homeCity: 'Springfield', insurer: null, planId: null,
    travelLimitMiles: 100, goals: ['second opinion'], ...over,
  });

  describe('list', () => {
    it('throws when the case does not exist', async () => {
      fakeDb.enqueue([]);
      await expect(plan.list('missing')).rejects.toThrow('Case not found');
    });
    it('returns null send state when no notification was ever sent', async () => {
      fakeDb.enqueue([caseRow()], []);
      expect((await plan.list('case1')).notification).toMatchObject({ lastSentAt: null, lastDigestOn: null });
    });
    it('returns only follow_up_1/2 rows plus notification settings with ISO timestamps', async () => {
      fakeDb.enqueue(
        [caseRow({ patientNotifyLastAt: new Date('2026-10-22T00:00:00.000Z'), patientNotifyDigestOn: '2026-10-22' })],
        [{ id: 'c1' }],
        [message(), message({ id: 'm2', classification: 'follow_up_2', approvedAt: APPROVED_AT, sentAt: APPROVED_AT }), message({ id: 'm3', classification: null }), message({ id: 'm4', classification: 'reply' })],
      );
      const out = await plan.list('case1');
      expect(out.followUps.map((f) => f.messageId)).toEqual(['m1', 'm2']);
      expect(out.followUps[1]).toMatchObject({ approvedAt: APPROVED_AT.toISOString(), sentAt: APPROVED_AT.toISOString() });
      expect(out.followUps[0]).toMatchObject({ approvedAt: null, sentAt: null });
      expect(out.notification).toEqual({ patientEmail: 'patient@example.com', optIn: true, homeState: 'IL', lastSentAt: '2026-10-22T00:00:00.000Z', lastDigestOn: '2026-10-22' });
    });
  });

  describe('approve', () => {
    it('refuses without a consent timestamp and touches nothing', async () => {
      await expect(plan.approve({ ...input({ consentApprovedAt: null }), approvedAt: APPROVED_AT })).rejects.toThrow(/Consent must be approved/);
      expect(fakeDb.ops).toHaveLength(0);
    });
    it('inserts missing rows with the canonical body and the consent fingerprint', async () => {
      fakeDb.enqueue([], [message({ id: 'n1' })], [], [message({ id: 'n2', classification: 'follow_up_2' })]);
      const out = await plan.approve({ ...input(), approvedAt: APPROVED_AT });
      expect(out.map((i) => i.messageId)).toEqual(['n1', 'n2']);
      const inserts = fakeDb.opsOf('insert');
      expect(inserts).toHaveLength(2);
      const values = inserts[0].calls.find((c) => c.method === 'values')?.args[0] as Record<string, unknown>;
      expect(values).toMatchObject({ body: canonicalFollowUp('email').body, approvalFingerprint: approvalFingerprint(snapshot, ['diseaseName'], CONSENT_AT), sentAt: null });
    });
    it('updates existing unsent rows and passes sent rows through unchanged', async () => {
      fakeDb.enqueue([message({ id: 'old1' })], [message({ id: 'old1', approvedAt: APPROVED_AT })], [message({ id: 'old2', classification: 'follow_up_2', sentAt: APPROVED_AT })]);
      const out = await plan.approve({ ...input(), approvedAt: APPROVED_AT });
      expect(fakeDb.opsOf('update')).toHaveLength(1);
      expect(fakeDb.opsOf('insert')).toHaveLength(0);
      expect(out[0].approvedAt).toBe(APPROVED_AT.toISOString());
      expect(out[1].sentAt).toBe(APPROVED_AT.toISOString());
    });
  });

  describe('cancelPending', () => {
    it('revokes only unsent, approved follow-up rows', async () => {
      fakeDb.enqueue([
        message({ id: 'a', approvedAt: APPROVED_AT }),
        message({ id: 'b', approvedAt: APPROVED_AT, sentAt: APPROVED_AT }),
        message({ id: 'c', approvedAt: null }),
        message({ id: 'd', classification: null, approvedAt: APPROVED_AT }),
        message({ id: 'e', classification: 'reply', approvedAt: APPROVED_AT }),
      ]);
      expect(await plan.cancelPending('c1', 'reply')).toEqual({ revoked: 1 });
      expect(fakeDb.opsOf('update')).toHaveLength(1);
    });
    it('revoke delegates to cancelPending', async () => {
      fakeDb.enqueue([]);
      expect(await plan.revoke('c1')).toEqual({ revoked: 0 });
    });
  });

  describe('getMessage', () => {
    it('returns null when no row matches', async () => {
      fakeDb.enqueue([]);
      expect(await plan.getMessage('c1', 2)).toBeNull();
    });
    it('maps a row to a preapproved message', async () => {
      fakeDb.enqueue([message({ classification: 'follow_up_2', approvedAt: APPROVED_AT })]);
      expect(await plan.getMessage('c1', 2)).toMatchObject({ id: 'm1', classification: 'follow_up_2', approvedAt: APPROVED_AT.toISOString() });
    });
  });

  describe('contextFor', () => {
    const contact = { id: 'c1', caseId: 'case1', state: 'sent' };
    it.each([
      ['contact missing', [[]]],
      ['case missing', [[contact], [], [{ sharedFields: ['x'], approvedAt: APPROVED_AT }]]],
      ['consent missing', [[contact], [caseRow()], []]],
    ])('returns null when %s', async (_name, queue) => {
      fakeDb.enqueue(...(queue as unknown[]));
      expect(await plan.contextFor('c1')).toBeNull();
    });
    it('builds the approval context from case, consent and contact', async () => {
      fakeDb.enqueue([contact], [caseRow()], [{ sharedFields: ['diseaseName'], approvedAt: new Date(CONSENT_AT) }]);
      expect(await plan.contextFor('c1')).toEqual({ snapshot, sharedFields: ['diseaseName'], consentApprovedAt: CONSENT_AT, contactState: 'sent' });
    });
    it('reports a null consent timestamp when consent was never approved', async () => {
      fakeDb.enqueue([contact], [caseRow({ diseaseCodes: undefined })], [{ sharedFields: [], approvedAt: null }]);
      const ctx = await plan.contextFor('c1');
      expect(ctx?.consentApprovedAt).toBeNull();
      expect(ctx?.snapshot.diseaseCodes).toBeNull();
    });
  });

  describe('saveNotification', () => {
    it('rejects an invalid email before querying', async () => {
      await expect(plan.saveNotification('case1', { patientEmail: 'nope', optIn: false }, POLICY)).rejects.toThrow('Invalid patient email');
      expect(fakeDb.ops).toHaveLength(0);
    });
    it('rejects an opted-in email outside the allowlist before querying', async () => {
      await expect(plan.saveNotification('case1', { patientEmail: 'stranger@example.net', optIn: true }, POLICY)).rejects.toThrow(/OUTBOUND_ALLOWLIST/);
      expect(fakeDb.ops).toHaveLength(0);
    });
    it('maps null send state and keeps a null digest day', async () => {
      fakeDb.enqueue([caseRow({ patientNotifyLastAt: null })]);
      expect(await plan.saveNotification('case1', { patientEmail: null, optIn: false }, POLICY)).toMatchObject({ lastSentAt: null, lastDigestOn: null });
    });
    it('throws when the case row was not updated', async () => {
      fakeDb.enqueue([]);
      await expect(plan.saveNotification('ghost', { patientEmail: null, optIn: false }, POLICY)).rejects.toThrow('Case not found');
    });
    it('returns the updated settings, including ISO last-sent time', async () => {
      fakeDb.enqueue([caseRow({ patientNotifyLastAt: new Date('2026-10-22T00:00:00.000Z') })]);
      const saved = await plan.saveNotification('case1', { patientEmail: ' Patient@Example.com ', optIn: true }, POLICY);
      expect(saved).toMatchObject({ patientEmail: 'patient@example.com', optIn: true, lastSentAt: '2026-10-22T00:00:00.000Z' });
      const set = fakeDb.opsOf('update')[0].calls.find((c) => c.method === 'set')?.args[0];
      expect(set).toEqual({ patientEmail: 'patient@example.com', patientNotifyOptIn: true });
    });
  });

  it('recordNotify writes the sent time and digest day', async () => {
    fakeDb.enqueue([]);
    await plan.recordNotify('case1', { lastSentAt: '2026-10-22T00:00:00.000Z', lastDigestOn: '2026-10-22' });
    const set = fakeDb.opsOf('update')[0].calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>;
    expect(set.patientNotifyLastAt).toEqual(new Date('2026-10-22T00:00:00.000Z'));
    expect(set.patientNotifyDigestOn).toBe('2026-10-22');
  });
});
