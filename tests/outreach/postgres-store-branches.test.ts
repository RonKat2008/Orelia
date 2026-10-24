import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', async () => {
  const { fakeDb } = await import('../helpers/db/fake-chain-db');
  return { getDb: () => fakeDb };
});

import { fakeDb } from '../helpers/db/fake-chain-db';
import { PostgresOutreachStore } from '../../lib/outreach/postgres-store';
import { OutreachError, type Contact, type Draft } from '../../lib/outreach/types';

const store = new PostgresOutreachStore();
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const APPROVED = '2026-10-21T10:00:00.000Z';

const contact = (address: string, over: Partial<Contact> = {}): Contact =>
  ({ id: crypto.randomUUID(), caseId: CASE_ID, targetId: crypto.randomUUID(), targetKind: 'institution', channel: 'email', address, state: 'drafted', ...over }) as Contact;
const draft = (over: Partial<Draft> = {}): Draft => ({
  id: 'd1', contactId: 'c1', caseId: CASE_ID, channel: 'email', address: 'intake@example.org', subject: 'Hello', body: 'Body',
  sharedFields: ['diseaseName'], approvedAt: null, sentAt: null, ...over,
}) as Draft;

beforeEach(() => fakeDb.reset());

describe('getCase', () => {
  it('returns undefined for an unknown case', async () => {
    fakeDb.enqueue([]);
    expect(await store.getCase('nope')).toBeUndefined();
  });
  it('returns only patient fields, never ids or status', async () => {
    fakeDb.enqueue([{
      id: CASE_ID, status: 'intake', diseaseName: 'fictional disease', diseaseCodes: null, subtype: null, stageSummary: null,
      homeCity: 'Springfield', homeState: 'IL', insurer: null, planId: null, travelLimitMiles: 50, goals: ['g'], createdAt: new Date(),
    }]);
    const out = await store.getCase(CASE_ID);
    expect(Object.keys(out ?? {}).sort()).toEqual(['diseaseCodes', 'diseaseName', 'goals', 'homeCity', 'homeState', 'insurer', 'planId', 'stageSummary', 'subtype', 'travelLimitMiles']);
  });
});

describe('candidates', () => {
  it('attaches evidence and the organization purpose for organization targets', async () => {
    fakeDb.enqueue([{ id: 'k1', targetId: 't1', targetKind: 'organization' }], [{ id: 'e1' }], [{ id: 't1', kind: 'advocacy' }]);
    const [c] = await store.candidates(CASE_ID, ['k1']);
    expect(c).toMatchObject({ id: 'k1', evidence: [{ id: 'e1' }], purpose: 'advocacy' });
  });
  it('skips the organization lookup for other target kinds', async () => {
    fakeDb.enqueue([{ id: 'k1', targetId: 't1', targetKind: 'expert' }], [{ id: 'e1' }]);
    const [c] = await store.candidates(CASE_ID, ['k1']);
    expect(c.purpose).toBeUndefined();
    expect(fakeDb.opsOf('select')).toHaveLength(2);
  });
  it('returns an empty list when nothing matches', async () => {
    fakeDb.enqueue([]);
    expect(await store.candidates(CASE_ID, ['k1'])).toEqual([]);
  });
});

describe('contact / contacts', () => {
  it('contact returns undefined when missing', async () => {
    fakeDb.enqueue([]);
    expect(await store.contact('x')).toBeUndefined();
  });
  it('contact adds the organization purpose for organization targets', async () => {
    fakeDb.enqueue([{ id: 'c1', targetId: 't1', targetKind: 'organization' }], [{ id: 't1', kind: 'center' }]);
    expect(await store.contact('c1')).toMatchObject({ id: 'c1', purpose: 'center' });
  });
  it('contact leaves purpose undefined for non-organization targets', async () => {
    fakeDb.enqueue([{ id: 'c1', targetId: 't1', targetKind: 'expert' }]);
    expect((await store.contact('c1'))?.purpose).toBeUndefined();
  });
  it('contacts lists rows for the case', async () => {
    fakeDb.enqueue([{ id: 'c1' }, { id: 'c2' }]);
    expect(await store.contacts(CASE_ID)).toHaveLength(2);
  });
});

describe('select', () => {
  it('returns [] without touching the database when nothing is proposed', async () => {
    expect(await store.select(CASE_ID, [], 5)).toEqual([]);
    expect(fakeDb.ops).toHaveLength(0);
  });
  it('returns the stored contacts matching the proposal after an insert', async () => {
    const proposed = [contact('Intake@Example.org ')];
    fakeDb.enqueue([[], { rows: [{ id: proposed[0].id }] }], [{ ...proposed[0], address: 'intake@example.org' }, contact('other@example.org')]);
    const out = await store.select(CASE_ID, proposed, 5);
    expect(out.map((c) => c.address)).toEqual(['intake@example.org']);
  });
  it('is idempotent: when every proposed address already exists nothing is inserted and the existing rows return', async () => {
    const proposed = [contact('intake@example.org')];
    fakeDb.enqueue([[], { rows: [] }], [{ ...proposed[0] }]);
    expect(await store.select(CASE_ID, proposed, 5)).toHaveLength(1);
  });
  it('rejects with a 422 contact_cap error when the cap blocked the insert of a missing address', async () => {
    fakeDb.enqueue([[], { rows: [] }], []);
    const err = await store.select(CASE_ID, [contact('new@example.org')], 1).catch((e) => e);
    expect(err).toBeInstanceOf(OutreachError);
    expect(err).toMatchObject({ status: 422 });
  });
});

describe('consent', () => {
  it('is undefined when no consent row exists', async () => {
    fakeDb.enqueue([]);
    expect(await store.consent('c1')).toBeUndefined();
  });
  it('is undefined when the row was never approved', async () => {
    fakeDb.enqueue([{ sharedFields: ['x'], approvedAt: null }]);
    expect(await store.consent('c1')).toBeUndefined();
  });
  it('maps an approved row to an ISO timestamp', async () => {
    fakeDb.enqueue([{ sharedFields: ['x'], approvedAt: new Date(APPROVED) }]);
    expect(await store.consent('c1')).toEqual({ contactId: 'c1', sharedFields: ['x'], approvedAt: APPROVED });
  });
  it('saveConsent replaces the consent in one batch', async () => {
    fakeDb.enqueue([]);
    await store.saveConsent({ contactId: 'c1', sharedFields: ['x'], approvedAt: APPROVED });
    expect(fakeDb.opsOf('batch')).toHaveLength(1);
    expect(fakeDb.opsOf('delete')).toHaveLength(1);
    expect(fakeDb.opsOf('insert')).toHaveLength(1);
  });
});

describe('drafts', () => {
  it('saveDraft inserts an outbound message', async () => {
    fakeDb.enqueue([]);
    await store.saveDraft(draft());
    const values = fakeDb.opsOf('insert')[0].calls.find((c) => c.method === 'values')?.args[0];
    expect(values).toMatchObject({ id: 'd1', direction: 'outbound', sharedFields: ['diseaseName'] });
  });
  describe('pendingDraft', () => {
    const c = contact('intake@example.org', { id: 'c1' });
    it('returns undefined when no pending row has the same shared fields in the same order', async () => {
      fakeDb.enqueue([{ id: 'm1', sharedFields: ['b', 'a'], subject: null, body: 'x' }, { id: 'm2', sharedFields: ['a'], subject: null, body: 'x' }]);
      expect(await store.pendingDraft(c, ['a', 'b'])).toBeUndefined();
    });
    it('maps a matching row, converting a null subject to undefined', async () => {
      fakeDb.enqueue([{ id: 'm1', contactId: 'c1', sharedFields: ['a', 'b'], subject: null, body: 'x' }]);
      const out = await store.pendingDraft(c, ['a', 'b']);
      expect(out).toMatchObject({ id: 'm1', subject: undefined, address: 'intake@example.org', approvedAt: null, sentAt: null, channel: 'email' });
    });
    it('keeps a present subject', async () => {
      fakeDb.enqueue([{ id: 'm1', sharedFields: [], subject: 'Hi', body: 'x' }]);
      expect((await store.pendingDraft(c, []))?.subject).toBe('Hi');
    });
  });
  describe('pendingFollowUp', () => {
    const c = contact('intake@example.org', { id: 'c1', state: 'sent' });
    it('is undefined when no unapproved follow-up exists', async () => {
      fakeDb.enqueue([]);
      expect(await store.pendingFollowUp(c)).toBeUndefined();
    });
    it('maps the follow-up row with its classification, unapproved and unsent', async () => {
      fakeDb.enqueue([{ id: 'f1', contactId: 'c1', sharedFields: ['a'], subject: 'Re: Patient intake inquiry', body: 'x', classification: 'follow_up_1', approvedAt: null, sentAt: null }]);
      expect(await store.pendingFollowUp(c)).toMatchObject({ id: 'f1', classification: 'follow_up_1', address: 'intake@example.org', approvedAt: null, sentAt: null, caseId: CASE_ID });
    });
  });
  describe('sentDraft', () => {
    const c = contact('intake@example.org', { id: 'c1', state: 'sent' });
    it('is undefined when nothing was sent', async () => {
      fakeDb.enqueue([]);
      expect(await store.sentDraft(c)).toBeUndefined();
    });
    it('maps the latest sent row with ISO timestamps', async () => {
      fakeDb.enqueue([{ id: 'm1', contactId: 'c1', sharedFields: ['a'], subject: null, body: 'x', approvedAt: new Date(APPROVED), sentAt: new Date(APPROVED) }]);
      expect(await store.sentDraft(c)).toMatchObject({ id: 'm1', subject: undefined, address: 'intake@example.org', approvedAt: APPROVED, sentAt: APPROVED, channel: 'email' });
    });
  });
  describe('draft', () => {
    const c = contact('intake@example.org', { id: 'c1' });
    it('is undefined for an unknown draft', async () => {
      fakeDb.enqueue([]);
      expect(await store.draft('d1', c)).toBeUndefined();
    });
    it('maps approval and send timestamps to ISO strings', async () => {
      fakeDb.enqueue([{ id: 'd1', subject: 'S', approvedAt: new Date(APPROVED), sentAt: new Date(APPROVED), sharedFields: [], body: 'b' }]);
      expect(await store.draft('d1', c)).toMatchObject({ subject: 'S', approvedAt: APPROVED, sentAt: APPROVED });
    });
    it('leaves unset timestamps undefined', async () => {
      fakeDb.enqueue([{ id: 'd1', subject: null, approvedAt: null, sentAt: null, sharedFields: [], body: 'b' }]);
      expect(await store.draft('d1', c)).toMatchObject({ subject: undefined, approvedAt: undefined, sentAt: undefined });
    });
  });
});

describe('reserve', () => {
  it('is true only when exactly one row was claimed', async () => {
    fakeDb.enqueue([[], { rows: [{ id: 'd1' }] }]);
    expect(await store.reserve(draft(), APPROVED)).toBe(true);
  });
  it('is false when the compare-and-set claimed nothing (already approved, consent changed, or other approval exists)', async () => {
    fakeDb.enqueue([[], { rows: [] }]);
    expect(await store.reserve(draft({ subject: undefined }), APPROVED)).toBe(false);
  });
});

describe('delivered', () => {
  const ref = { messageId: 'pm1', threadId: 'pt1', callId: 'call1' };
  it('records a voice send and also creates the call row', async () => {
    fakeDb.enqueue([]);
    await store.delivered(draft({ channel: 'voice', address: '+15550100' }), ref, APPROVED);
    expect(fakeDb.opsOf('insert')).toHaveLength(1);
    expect(fakeDb.opsOf('update')).toHaveLength(2);
    expect(fakeDb.opsOf('batch')).toHaveLength(1);
  });
  it('records an email send without creating a call row', async () => {
    fakeDb.enqueue([]);
    await store.delivered(draft(), ref, APPROVED);
    expect(fakeDb.opsOf('insert')).toHaveLength(0);
    expect(fakeDb.opsOf('update')).toHaveLength(2);
  });
});
