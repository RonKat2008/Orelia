import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const {
  asMemoryActivity, getCaseActivity, MemoryCaseActivity, PostgresCaseActivity, resetCaseActivity,
} = await import('@/lib/cases/activity');

const CASE = crypto.randomUUID();
const id = () => crypto.randomUUID();
const D1 = new Date('2026-10-01T10:00:00.000Z');
const D2 = new Date('2026-10-02T10:00:00.000Z');

const contactRow = (over: Record<string, unknown> = {}) => ({
  id: id(), caseId: CASE, targetKind: 'expert', targetId: id(), channel: 'email', state: 'drafted',
  nextFollowUpAt: null, lastActivityAt: null, ...over,
});
const setup = () => {
  const fake = createChainDb();
  holder.db = fake.db;
  return { fake, activity: new PostgresCaseActivity() };
};

afterEach(() => { resetCaseActivity(); vi.unstubAllEnvs(); });

describe('PostgresCaseActivity.contacts', () => {
  it('returns nothing without contacts and never queries names', async () => {
    const { fake, activity } = setup();
    expect(await activity.contacts(CASE)).toEqual([]);
    expect(fake.callsFor('select:experts')).toHaveLength(0);
  });

  it('resolves display names for every kind, with an unknown fallback', async () => {
    const { fake, activity } = setup();
    const rows = [
      contactRow({ targetKind: 'expert' }), contactRow({ targetKind: 'institution' }),
      contactRow({ targetKind: 'trial' }), contactRow({ targetKind: 'organization' }),
      contactRow({ targetKind: 'organization' }),
    ];
    fake.queue('select:contacts', rows);
    fake.queue('select:experts', [{ id: rows[0].targetId, name: 'Dr E' }]);
    fake.queue('select:institutions', [{ id: rows[1].targetId, name: 'Inst I' }]);
    fake.queue('select:trials', [{ id: rows[2].targetId, name: 'Trial T' }]);
    fake.queue('select:organizations', [{ id: rows[3].targetId, name: 'Org O' }]);
    const out = await activity.contacts(CASE);
    expect(out.map((c) => c.displayName)).toEqual(['Dr E', 'Inst I', 'Trial T', 'Org O', '(unknown)']);
  });

  it('flags consent only when approved and approval only for approved outbound mail', async () => {
    const { fake, activity } = setup();
    const [a, b, c] = [contactRow(), contactRow(), contactRow()];
    fake.queue('select:contacts', [a, b, c]);
    fake.queue('select:consents', [{ contactId: a.id, approvedAt: D1 }, { contactId: b.id, approvedAt: null }]);
    fake.queue('select:messages', [{ contactId: b.id }]);
    const out = await activity.contacts(CASE);
    expect(out.map((x) => [x.consented, x.approved])).toEqual([[true, false], [false, true], [false, false]]);
  });

  it('serialises follow-up and activity timestamps as ISO strings or null', async () => {
    const { fake, activity } = setup();
    fake.queue('select:contacts', [contactRow({ nextFollowUpAt: D1, lastActivityAt: D2 })]);
    const [c] = await activity.contacts(CASE);
    expect(c.nextFollowUpAt).toBe(D1.toISOString());
    expect(c.lastActivityAt).toBe(D2.toISOString());
  });

  it('rejects rows that violate the response schema', async () => {
    const { fake, activity } = setup();
    fake.queue('select:contacts', [contactRow({ channel: 'carrier-pigeon' })]);
    await expect(activity.contacts(CASE)).rejects.toThrow();
  });
});

describe('PostgresCaseActivity.tasks', () => {
  it('returns nothing without contacts', async () => {
    const { fake, activity } = setup();
    expect(await activity.tasks(CASE)).toEqual([]);
    expect(fake.callsFor('select:tasks')).toHaveLength(0);
  });

  it('maps approved vs open, blank titles and due dates', async () => {
    const { fake, activity } = setup();
    const contactId = id();
    fake.queue('select:contacts', [{ id: contactId }]);
    fake.queue('select:tasks', [
      { id: id(), contactId, kind: 'review', title: null, status: 'approved', dueAt: D1 },
      { id: id(), contactId, kind: 'reply', title: 'Reply', status: 'open', dueAt: null },
      { id: id(), contactId, kind: 'other', title: 'Odd', status: 'snoozed', dueAt: null },
    ]);
    const out = await activity.tasks(CASE);
    expect(out.map((t) => [t.title, t.status, t.dueAt])).toEqual([
      ['', 'approved', D1.toISOString()], ['Reply', 'open', null], ['Odd', 'open', null],
    ]);
  });
});

describe('PostgresCaseActivity.threads', () => {
  it('returns nothing without contacts', async () => {
    const { fake, activity } = setup();
    expect(await activity.threads(CASE)).toEqual([]);
    expect(fake.callsFor('select:messages')).toHaveLength(0);
    expect(fake.callsFor('select:calls')).toHaveLength(0);
  });

  it('merges mail and call transcripts per contact, skipping calls without transcripts', async () => {
    const { fake, activity } = setup();
    const a = contactRow(); const b = contactRow();
    fake.queue('select:contacts', [a, b]);
    // contacts() issues its own consent/messages selects first, then threads() reads messages and calls.
    fake.queue('select:messages',
      [],
      [
        { id: id(), contactId: a.id, direction: 'inbound', channel: 'email', subject: 'Re', body: 'Hi', sharedFields: [], sentAt: null, receivedAt: D2, classification: 'reply' },
        { id: id(), contactId: a.id, direction: 'outbound', channel: 'email', subject: null, body: 'Out', sharedFields: ['diseaseName'], sentAt: D1, receivedAt: null, classification: null },
        { id: id(), contactId: a.id, direction: 'draft', channel: 'email', subject: null, body: 'Odd', sharedFields: [], sentAt: null, receivedAt: null, classification: null },
      ]);
    fake.queue('select:calls', [
      { id: id(), contactId: a.id, transcript: 'Transcript text', startedAt: D1 },
      { id: id(), contactId: a.id, transcript: null, startedAt: D1 },
      { id: id(), contactId: b.id, transcript: 'Other contact', startedAt: null },
    ]);
    const threads = await activity.threads(CASE);
    expect(threads).toHaveLength(2);
    const first = threads[0].messages;
    expect(first.map((m) => [m.direction, m.channel, m.at])).toEqual([
      ['inbound', 'email', D2.toISOString()], ['outbound', 'email', D1.toISOString()], ['outbound', 'email', null],
      ['outbound', 'voice', D1.toISOString()],
    ]);
    expect(first[3]).toMatchObject({ body: 'Transcript text', subject: null, sharedFields: [], classification: null });
    expect(threads[1].messages).toEqual([expect.objectContaining({ body: 'Other contact', at: null })]);
  });
});

describe('MemoryCaseActivity', () => {
  const view = (over: Record<string, unknown> = {}) => ({
    id: id(), targetKind: 'expert' as const, targetId: id(), displayName: 'Dr Seed', channel: 'email' as const, state: 'drafted',
    nextFollowUpAt: null, lastActivityAt: null, consented: false, approved: false, ...over,
  });

  it('returns empty collections for unknown cases', async () => {
    const m = new MemoryCaseActivity();
    expect(await m.contacts(CASE)).toEqual([]);
    expect(await m.tasks(CASE)).toEqual([]);
    expect(await m.threads(CASE)).toEqual([]);
  });

  it('seeds contacts, tasks and per-contact messages and returns copies', async () => {
    const m = new MemoryCaseActivity();
    const a = view(); const b = view({ displayName: 'Dr Two' });
    m.seedContact(CASE, a); m.seedContact(CASE, b);
    const taskId = id();
    m.seedTask(CASE, { id: taskId, contactId: a.id, kind: 'review', title: 'T', status: 'open', dueAt: null });
    m.seedMessage(CASE, { id: id(), contactId: a.id, direction: 'outbound', channel: 'email', subject: null, body: 'Hello', sharedFields: [], at: null, classification: null });
    const contacts = await m.contacts(CASE);
    contacts[0].displayName = 'mutated';
    expect((await m.contacts(CASE))[0].displayName).toBe('Dr Seed');
    expect((await m.tasks(CASE)).map((t) => t.id)).toEqual([taskId]);
    const threads = await m.threads(CASE);
    expect(threads.map((t) => t.messages.length)).toEqual([1, 0]);
    expect(threads[0].messages[0]).not.toHaveProperty('contactId');
    expect(threads[1].label).toBe('Dr Two');
  });
});

describe('activity singleton helpers', () => {
  it('picks the implementation from DATABASE_URL, memoises, and resets', () => {
    vi.stubEnv('DATABASE_URL', '');
    const mem = getCaseActivity();
    expect(mem).toBeInstanceOf(MemoryCaseActivity);
    expect(getCaseActivity()).toBe(mem);
    resetCaseActivity();
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic@localhost/synthetic');
    expect(getCaseActivity()).toBeInstanceOf(PostgresCaseActivity);
  });

  it('asMemoryActivity accepts memory implementations and rejects others', () => {
    const mem = new MemoryCaseActivity();
    expect(asMemoryActivity(mem)).toBe(mem);
    expect(() => asMemoryActivity(new PostgresCaseActivity())).toThrow('expected memory activity');
  });
});
