import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

type Op = { op: string; values?: unknown; set?: unknown; where?: unknown; limit?: number };
const ops: Op[] = [];
/** Queue of result sets; each query consumes one. */
let results: unknown[][] = [];

/** Chainable, thenable fake of the drizzle builder: every terminal resolves to the next queued result. */
function builder(op: Op) {
  ops.push(op);
  const settle = () => results.shift() ?? [];
  const chain: Record<string, unknown> = {
    values: (v: unknown) => { op.values = v; return chain; },
    set: (v: unknown) => { op.set = v; return chain; },
    from: () => chain,
    where: (w: unknown) => { op.where = w; return chain; },
    orderBy: () => chain,
    limit: (n: number) => { op.limit = n; return chain; },
    returning: async () => settle(),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej),
  };
  return chain;
}
vi.mock('../../db/client', () => ({
  getDb: () => ({
    insert: () => builder({ op: 'insert' }),
    update: () => builder({ op: 'update' }),
    select: () => builder({ op: 'select' }),
  }),
}));

import { MemoryTaskStore, PostgresTaskStore } from '../../lib/inbox/task-store';
import type { TaskDraft } from '../../lib/inbox/drafts';

const id = () => crypto.randomUUID();
const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  contactId: id(), caseId: id(), kind: 'unclear', title: 'Review the reply', status: 'open', requiresApproval: true, approvedAt: null, ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: id(), contactId: id(), caseId: id(), kind: 'unclear', title: 'T', status: 'open', draftBody: 'body',
  details: { letter: null, details: { quote: 'q' } }, approvedAt: null, dueAt: null, ...over,
});

beforeEach(() => { ops.length = 0; results = []; });

describe('PostgresTaskStore.saveTasks', () => {
  it('returns [] without touching the database when given no drafts', async () => {
    expect(await new PostgresTaskStore().saveTasks([])).toEqual([]);
    expect(ops).toHaveLength(0);
  });
  it('inserts every draft as an open row and maps the returned rows back to tasks', async () => {
    const a = draft(); const b = draft({ title: 'Second' });
    results = [[row({ title: a.title }), row({ title: b.title })]];
    const saved = await new PostgresTaskStore().saveTasks([a, b]);
    expect((ops[0]!.values as unknown[]).length).toBe(2);
    expect(saved.map(t => t.title)).toEqual([a.title, 'Second']);
    expect(saved.every(t => t.requiresApproval && t.status === 'open')).toBe(true);
  });
});

describe('PostgresTaskStore.task', () => {
  it('returns undefined when no row matches', async () => {
    results = [[]];
    expect(await new PostgresTaskStore().task(id())).toBeUndefined();
  });
  it('maps a found row to a StoredTask', async () => {
    const r = row({ title: 'Found' });
    results = [[r]];
    expect(await new PostgresTaskStore().task(r.id)).toMatchObject({ id: r.id, title: 'Found', details: { quote: 'q' } });
  });
});

describe('PostgresTaskStore.markDone', () => {
  it('without a patch only flips status and never reads the row first', async () => {
    await new PostgresTaskStore().markDone('t1');
    expect(ops.map(o => o.op)).toEqual(['update']);
    expect(ops[0]!.set).toEqual({ status: 'done' });
  });
  it('merges the patch into the existing details envelope, preserving the letter', async () => {
    results = [[row({ details: { letter: { subject: 's' }, details: { quote: 'q' } } })]];
    await new PostgresTaskStore().markDone('t1', { evidence: { claim: 'a@b.com' } });
    expect(ops.map(o => o.op)).toEqual(['select', 'update']);
    expect(ops[1]!.set).toEqual({ status: 'done', details: { letter: { subject: 's' }, details: { quote: 'q', evidence: { claim: 'a@b.com' } } } });
  });
  it('creates the envelope when the row has null details', async () => {
    results = [[row({ details: null })]];
    await new PostgresTaskStore().markDone('t1', { evidence: 1 });
    expect(ops[1]!.set).toEqual({ status: 'done', details: { details: { evidence: 1 } } });
  });
  it('creates the envelope when the inner details are null', async () => {
    results = [[row({ details: { letter: null, details: null } })]];
    await new PostgresTaskStore().markDone('t1', { evidence: 1 });
    expect(ops[1]!.set).toEqual({ status: 'done', details: { letter: null, details: { evidence: 1 } } });
  });
  it('still marks done with only the patch when the row has vanished', async () => {
    results = [[]];
    await new PostgresTaskStore().markDone('t1', { evidence: 1 });
    expect(ops[1]!.set).toEqual({ status: 'done', details: { details: { evidence: 1 } } });
  });
});

describe('PostgresTaskStore.nextCandidate', () => {
  it('returns undefined when every candidate already has a contact', async () => {
    results = [[]];
    expect(await new PostgresTaskStore().nextCandidate(id())).toBeUndefined();
  });
  it('returns the best-ranked candidate with only id, kind and target id, limited to one', async () => {
    const cand = { id: id(), targetKind: 'expert', targetId: id(), rank: 1, caseId: id() };
    results = [[cand]];
    expect(await new PostgresTaskStore().nextCandidate(cand.caseId)).toEqual({ id: cand.id, targetKind: 'expert', targetId: cand.targetId });
    expect(ops[0]!.limit).toBe(1);
    expect(new PgDialect().sqlToQuery(ops[0]!.where as never).sql).toContain('not exists');
  });
});

describe('PostgresTaskStore.closeContact', () => {
  it('marks the contact declined with a fresh activity timestamp', async () => {
    await new PostgresTaskStore().closeContact('c1');
    expect(ops[0]!.set).toMatchObject({ state: 'declined', lastActivityAt: expect.any(Date) });
  });
});

describe('MemoryTaskStore edge cases', () => {
  it('reopen is a no-op for open tasks and unknown ids', async () => {
    const store = new MemoryTaskStore();
    const [t] = await store.saveTasks([draft()]);
    await store.reopen(t!.id); await store.reopen(id());
    expect(await store.task(t!.id)).toMatchObject({ status: 'open', approvedAt: null });
  });
  it('markDone merges a patch into details, tolerates unknown ids, and returns clones', async () => {
    const store = new MemoryTaskStore();
    const [t] = await store.saveTasks([draft({ details: { quote: 'q' } })]);
    await store.markDone(t!.id, { evidence: 1 }); await store.markDone(id(), { evidence: 2 });
    const got = await store.task(t!.id);
    expect(got).toMatchObject({ status: 'done', details: { quote: 'q', evidence: 1 } });
    got!.title = 'mutated';
    expect((await store.task(t!.id))!.title).not.toBe('mutated');
    expect(await store.task(id())).toBeUndefined();
  });
  it('cannot approve a task twice or an unknown task', async () => {
    const store = new MemoryTaskStore();
    const [t] = await store.saveTasks([draft()]);
    expect(await store.markApproved(t!.id, 'x')).toBe(true);
    expect(await store.markApproved(t!.id, 'x')).toBe(false);
    expect(await store.markApproved(id(), 'x')).toBe(false);
  });
});
