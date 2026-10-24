import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const calls: { op: string; set?: unknown; where?: unknown }[] = [];
let returned: unknown[] = [{ id: 'x' }];
vi.mock('../../db/client', () => ({
  getDb: () => ({
    update: () => {
      const call: { op: string; set?: unknown; where?: unknown } = { op: 'update' };
      calls.push(call);
      const chain = {
        set: (v: unknown) => { call.set = v; return chain; },
        where: (w: unknown) => { call.where = w; return chain; },
        returning: async () => returned,
        then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
      };
      return chain;
    },
  }),
}));

import { MemoryTaskStore, PostgresTaskStore, rowToTask, taskToRow, type StoredTask } from '../../lib/inbox/task-store';
import type { TaskDraft } from '../../lib/inbox/drafts';

const id = () => crypto.randomUUID();
const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  contactId: id(), caseId: id(), kind: 'referral', title: 'Request a referral', status: 'open', requiresApproval: true, approvedAt: null,
  draftBody: 'Dear Dr. X, please refer me.', letter: { to: 'dr@example.com', subject: 'Referral', body: 'Dear Dr. X, please refer me.' } as TaskDraft['letter'],
  details: { accession: 'A1' }, ...over,
});
type Row = Parameters<typeof rowToTask>[0];
const rowFor = (d: TaskDraft, over: Partial<Row> = {}): Row => ({ ...(taskToRow(d) as unknown as Row), id: id(), dueAt: null, approvedAt: null, ...over });

describe('taskToRow / rowToTask', () => {
  it('writes real columns with plain draft text and a { letter, details } envelope', () => {
    const d = draft();
    const row = taskToRow(d);
    expect(row).toMatchObject({ title: d.title, caseId: d.caseId, contactId: d.contactId, kind: 'referral', status: 'open', draftBody: d.draftBody, approvedAt: null });
    expect(row.details).toEqual({ letter: d.letter, details: d.details });
    expect(() => JSON.parse(row.draftBody!)).toThrow();
  });
  it('round-trips a draft', () => {
    const d = draft();
    const t = rowToTask(rowFor(d));
    expect(t).toMatchObject({ title: d.title, caseId: d.caseId, draftBody: d.draftBody, letter: d.letter, details: d.details, status: 'open', approvedAt: null, requiresApproval: true });
  });
  it('round-trips a draft with no letter, details or text', () => {
    const t = rowToTask(rowFor(draft({ letter: undefined, details: undefined, draftBody: undefined })));
    expect(t.letter).toBeUndefined();
    expect(t.details).toBeUndefined();
    expect(t.draftBody).toBeUndefined();
  });
  it('reads approvedAt as an ISO string', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(rowToTask(rowFor(draft(), { approvedAt: at, status: 'approved' })).approvedAt).toBe(at.toISOString());
  });
  it('falls back to legacy JSON in draft_body when title/details are null', () => {
    const d = draft();
    const legacy = JSON.stringify({ title: 'Old title', caseId: d.caseId, letter: d.letter, details: d.details, text: 'old text' });
    const t = rowToTask(rowFor(d, { title: null, details: null, caseId: null, draftBody: legacy }));
    expect(t).toMatchObject({ title: 'Old title', caseId: d.caseId, letter: d.letter, details: d.details, draftBody: 'old text' });
  });
  it('does not throw on non-JSON or non-object draft_body when columns are null', () => {
    for (const body of ['Plain draft text', '{not json', '"a string"', '42', 'null', '[1,2]', null]) {
      const t = rowToTask(rowFor(draft(), { title: null, details: null, caseId: null, draftBody: body }));
      expect(t.title).toBe('');
      expect(t.letter).toBeUndefined();
      expect(t.draftBody).toBe(body ?? undefined);
    }
  });
  it('prefers columns over legacy JSON', () => {
    const d = draft();
    const t = rowToTask(rowFor(d, { draftBody: JSON.stringify({ title: 'stale', text: 'stale' }) }));
    expect(t.title).toBe(d.title);
    expect(t.draftBody).toContain('stale');
  });
});

describe('MemoryTaskStore approvedAt', () => {
  it('CAS approve sets approvedAt once; reopen clears it', async () => {
    const store = new MemoryTaskStore();
    const [t] = await store.saveTasks([draft()]) as [StoredTask];
    expect(await store.markApproved(t.id, '2026-01-01T00:00:00.000Z')).toBe(true);
    expect(await store.markApproved(t.id, '2026-02-02T00:00:00.000Z')).toBe(false);
    expect(await store.task(t.id)).toMatchObject({ status: 'approved', approvedAt: '2026-01-01T00:00:00.000Z' });
    await store.reopen(t.id);
    expect(await store.task(t.id)).toMatchObject({ status: 'open', approvedAt: null });
  });
});

describe('PostgresTaskStore.markApproved', () => {
  beforeEach(() => { calls.length = 0; returned = [{ id: 'x' }]; });
  it('issues a single conditional UPDATE setting approved_at and returns true on a hit', async () => {
    const at = '2026-01-01T00:00:00.000Z';
    expect(await new PostgresTaskStore().markApproved('x', at)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.set).toEqual({ status: 'approved', approvedAt: new Date(at) });
    const { sql, params } = new PgDialect().sqlToQuery(calls[0]!.where as never);
    expect(sql).toContain('"tasks"."id" = $1');
    expect(sql).toContain('"tasks"."status" = $2');
    expect(params).toEqual(['x', 'open']);
  });
  it('returns false when no row matched', async () => {
    returned = [];
    expect(await new PostgresTaskStore().markApproved('x', '2026-01-01T00:00:00.000Z')).toBe(false);
  });
  it('reopen clears approved_at', async () => {
    await new PostgresTaskStore().reopen('x');
    expect(calls[0]!.set).toEqual({ status: 'open', approvedAt: null });
  });
});
