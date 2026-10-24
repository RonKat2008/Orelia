import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', async () => {
  const { fakeDb } = await import('../helpers/db/fake-chain-db');
  return { getDb: () => fakeDb };
});

import { fakeDb } from '../helpers/db/fake-chain-db';
import { getApplicationStore, MemoryApplicationStore, PostgresApplicationStore } from '../../lib/web-application/store';
import type { WebApplicationDraft } from '../../lib/web-application/types';

const AT = '2026-10-21T10:00:00.000Z';
const draft = (over: Partial<WebApplicationDraft> = {}): WebApplicationDraft => ({
  id: 'a1', caseId: 'case1', contactId: 'c1', url: 'https://clinic.example.org/apply', fields: [], missing: [], formFingerprint: 'fp',
  screenshot: null, sharedFields: [], sharedDocIds: [], status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: AT, ...over,
});
const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 'a1', caseId: 'case1', contactId: 'c1', url: 'https://clinic.example.org/apply', fields: [], missing: [], formFingerprint: 'fp', screenshot: null,
  sharedFields: [], sharedDocIds: [], status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: new Date(AT), ...over,
});

describe('MemoryApplicationStore', () => {
  it('stores clones so callers cannot mutate persisted rows', async () => {
    const store = new MemoryApplicationStore();
    const saved = await store.save(draft());
    saved.sharedFields.push('leak');
    expect((await store.get('a1'))?.sharedFields).toEqual([]);
  });
  it('get is undefined for an unknown id and listByCase filters by case', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft()); await store.save(draft({ id: 'a2', caseId: 'case2' }));
    expect(await store.get('zzz')).toBeUndefined();
    expect((await store.listByCase('case1')).map((d) => d.id)).toEqual(['a1']);
  });
  it('approve is refused for unknown ids and for drafts that are no longer in draft', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft({ status: 'approved' }));
    expect(await store.approve('missing', { approvedAt: AT, sharedFields: [], sharedDocIds: [] })).toBe(false);
    expect(await store.approve('a1', { approvedAt: AT, sharedFields: [], sharedDocIds: [] })).toBe(false);
  });
  it('approve records the ticked fields and documents', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft());
    expect(await store.approve('a1', { approvedAt: AT, sharedFields: ['diseaseName'], sharedDocIds: ['doc1'] })).toBe(true);
    expect(await store.get('a1')).toMatchObject({ status: 'approved', approvedAt: AT, sharedFields: ['diseaseName'], sharedDocIds: ['doc1'] });
  });
  it('claimSubmit succeeds once; a second claim and an unknown id are refused', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft({ status: 'approved' }));
    expect(await store.claimSubmit('a1')).toBe(true);
    expect(await store.claimSubmit('a1')).toBe(false);
    expect(await store.claimSubmit('missing')).toBe(false);
  });
  it('finish stamps submittedAt only for submitted, keeps it otherwise, and ignores unknown ids', async () => {
    const store = new MemoryApplicationStore();
    await store.save(draft({ status: 'submitting' }));
    await store.finish('a1', 'failed', { error: 'x' }, AT);
    expect((await store.get('a1'))?.submittedAt).toBeNull();
    await store.finish('a1', 'submitted', { ok: true }, AT);
    expect(await store.get('a1')).toMatchObject({ status: 'submitted', submittedAt: AT, result: { ok: true } });
    await expect(store.finish('missing', 'failed', {}, AT)).resolves.toBeUndefined();
  });
  it('createReviewTask records a host-based title', async () => {
    const store = new MemoryApplicationStore();
    expect(await store.createReviewTask(draft())).toBe('a1');
    expect(store.reviewTasks[0].title).toBe('Review application at clinic.example.org');
  });
});

describe('PostgresApplicationStore', () => {
  beforeEach(() => fakeDb.reset());
  const store = new PostgresApplicationStore(fakeDb as never);

  it('save maps the returned row, converting nullable timestamps', async () => {
    fakeDb.enqueue([dbRow({ approvedAt: new Date(AT), submittedAt: new Date(AT) })]);
    expect(await store.save(draft())).toMatchObject({ id: 'a1', approvedAt: AT, submittedAt: AT, createdAt: AT });
  });
  it('save maps null timestamps and a missing result to null', async () => {
    fakeDb.enqueue([dbRow({ result: undefined })]);
    expect(await store.save(draft())).toMatchObject({ approvedAt: null, submittedAt: null, result: null });
  });
  it('get returns undefined when no row matches and a draft otherwise', async () => {
    fakeDb.enqueue([], [dbRow()]);
    expect(await store.get('none')).toBeUndefined();
    expect((await store.get('a1'))?.id).toBe('a1');
  });
  it('listByCase maps every row', async () => {
    fakeDb.enqueue([dbRow(), dbRow({ id: 'a2' })]);
    expect((await store.listByCase('case1')).map((d) => d.id)).toEqual(['a1', 'a2']);
  });
  it.each([
    ['approve', [{ id: 'a1' }], true], ['approve', [], false],
    ['claimSubmit', [{ id: 'a1' }], true], ['claimSubmit', [], false],
  ] as const)('%s is %s only when exactly the guarded row was updated (%j)', async (method, rows, expected) => {
    fakeDb.enqueue(rows);
    const result = method === 'approve'
      ? await store.approve('a1', { approvedAt: AT, sharedFields: [], sharedDocIds: [] })
      : await store.claimSubmit('a1');
    expect(result).toBe(expected);
  });
  it('finish sets submittedAt only for submitted', async () => {
    fakeDb.enqueue([], []);
    await store.finish('a1', 'submitted', { ok: true }, AT);
    await store.finish('a1', 'failed', { ok: false }, AT);
    const sets = fakeDb.opsOf('update').map((o) => o.calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>);
    expect(sets[0].submittedAt).toEqual(new Date(AT));
    expect('submittedAt' in sets[1]).toBe(false);
  });
  it('createReviewTask returns null for unlinked drafts without writing', async () => {
    expect(await store.createReviewTask(draft({ contactId: null }))).toBeNull();
    expect(fakeDb.ops).toHaveLength(0);
  });
  it('createReviewTask inserts a task and links it to the application', async () => {
    fakeDb.enqueue([{ id: 'task1' }], []);
    expect(await store.createReviewTask(draft({ missing: [{ fieldKey: 'k', label: 'K', required: true, reason: 'needs_patient', question: 'q' }] }))).toBe('task1');
    const values = fakeDb.opsOf('insert')[0].calls.find((c) => c.method === 'values')?.args[0] as { details: { missingCount: number } };
    expect(values.details.missingCount).toBe(1);
    expect(fakeDb.opsOf('update')).toHaveLength(1);
  });
});

describe('getApplicationStore', () => {
  const g = globalThis as unknown as { __wayfinderApplications?: unknown };
  const saved = { db: process.env.DATABASE_URL, offline: process.env.WAYFINDER_OFFLINE };
  beforeEach(() => { delete g.__wayfinderApplications; });
  afterEach(() => {
    delete g.__wayfinderApplications;
    if (saved.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.db;
    if (saved.offline === undefined) delete process.env.WAYFINDER_OFFLINE; else process.env.WAYFINDER_OFFLINE = saved.offline;
  });
  it('uses memory without DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    expect(getApplicationStore()).toBeInstanceOf(MemoryApplicationStore);
  });
  it('uses memory when WAYFINDER_OFFLINE=1 even with a database url', () => {
    process.env.DATABASE_URL = 'postgres://synthetic.invalid/db';
    process.env.WAYFINDER_OFFLINE = '1';
    expect(getApplicationStore()).toBeInstanceOf(MemoryApplicationStore);
  });
  it('uses Postgres with a database url online, and memoizes the instance', () => {
    process.env.DATABASE_URL = 'postgres://synthetic.invalid/db';
    delete process.env.WAYFINDER_OFFLINE;
    const first = getApplicationStore();
    expect(first).toBeInstanceOf(PostgresApplicationStore);
    expect(getApplicationStore()).toBe(first);
  });
});
