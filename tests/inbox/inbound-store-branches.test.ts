import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

let rows: unknown[] = [];
let where: unknown;
vi.mock('../../db/client', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: (w: unknown) => { where = w; return Promise.resolve(rows); } }) }) }),
}));
vi.mock('../../lib/outreach/postgres-store', () => ({ PostgresOutreachStore: class {} }));

import { MemoryInboundMessageStore, PostgresInboundMessageStore } from '../../lib/inbox/inbound-store';
import { getInboxHandlers } from '../../lib/inbox/server';

beforeEach(() => { rows = []; where = undefined; });

describe('PostgresInboundMessageStore.get', () => {
  it('returns the row and restricts the query to inbound direction', async () => {
    rows = [{ id: 'm1', contactId: 'c1', body: 'hi' }];
    expect(await new PostgresInboundMessageStore().get('m1')).toEqual(rows[0]);
    const { sql, params } = new PgDialect().sqlToQuery(where as never);
    expect(sql).toContain('"direction"');
    expect(params).toEqual(['m1', 'inbound']);
  });
  it('returns undefined when there is no such inbound message', async () => {
    expect(await new PostgresInboundMessageStore().get('missing')).toBeUndefined();
  });
});

describe('MemoryInboundMessageStore', () => {
  it('returns a copy so callers cannot mutate stored rows, and undefined for unknown ids', async () => {
    const store = new MemoryInboundMessageStore();
    store.add({ id: 'm1', contactId: 'c1', body: 'x' });
    const got = await store.get('m1');
    got!.body = 'changed';
    expect((await store.get('m1'))!.body).toBe('x');
    expect(await store.get('nope')).toBeUndefined();
  });
});

describe('getInboxHandlers', () => {
  it('lazily builds the handlers once and reuses them', () => {
    const first = getInboxHandlers();
    expect(first).toEqual({ approve: expect.any(Function), get: expect.any(Function) });
    expect(getInboxHandlers()).toBe(first);
  });
});
