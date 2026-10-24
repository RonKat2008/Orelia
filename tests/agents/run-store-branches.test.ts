import { describe, expect, it } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';
import { DbRunStore, MemoryRunStore } from '@/lib/agents/run-store';

const CASE = 'case-1';
const dbStore = () => {
  const fake = createChainDb();
  return { fake, store: new DbRunStore(fake.db as unknown as ConstructorParameters<typeof DbRunStore>[0]) };
};
const setOf = (fake: ReturnType<typeof createChainDb>) =>
  fake.callsFor('update:agent_runs')[0].methods.find((m) => m.name === 'set')?.args[0] as Record<string, unknown>;

describe('MemoryRunStore', () => {
  it('creates queued runs with empty usage and lists them per case', async () => {
    const store = new MemoryRunStore();
    const id = await store.create(CASE, 'pubmed');
    await store.create('other-case', 'pubmed');
    const runs = await store.listByCase(CASE);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id, status: 'queued', counts: null, error: null, outputSummary: null, startedAt: null });
  });

  it('throws when updating an unknown run', async () => {
    await expect(new MemoryRunStore().update('missing', { status: 'running' })).rejects.toThrow('Unknown agent run missing');
  });

  it('keeps previous values for omitted patch fields and overwrites provided ones', async () => {
    const store = new MemoryRunStore();
    const id = await store.create(CASE, 'ctgov');
    const started = new Date('2026-01-01T00:00:00Z');
    await store.update(id, { status: 'running', startedAt: started, tokensIn: 5, costUsd: 0.5, counts: { a: 1 } });
    await store.update(id, { status: 'done', tokensOut: 7, error: 'boom', outputSummary: 'ok', finishedAt: started, cacheRead: 1, cacheCreation: 2 });
    const [run] = await store.listByCase(CASE);
    expect(run).toMatchObject({
      status: 'done', tokensIn: 5, tokensOut: 7, cacheRead: 1, cacheCreation: 2, costUsd: 0.5,
      counts: { a: 1 }, error: 'boom', outputSummary: 'ok', startedAt: started, finishedAt: started,
    });
  });

  it('allows costUsd to be explicitly cleared to null', async () => {
    const store = new MemoryRunStore();
    const id = await store.create(CASE, 'ctgov');
    await store.update(id, { status: 'running', costUsd: 1 });
    await store.update(id, { status: 'done', costUsd: null as unknown as number });
    expect((await store.listByCase(CASE))[0].costUsd).toBeNull();
  });
});

describe('DbRunStore', () => {
  it('returns the new run id', async () => {
    const { fake, store } = dbStore();
    fake.queue('insert:agent_runs', [{ id: 'run-1' }]);
    expect(await store.create(CASE, 'exa')).toBe('run-1');
  });

  it('throws when the insert returns no row', async () => {
    const { store } = dbStore();
    await expect(store.create(CASE, 'exa')).rejects.toThrow('Failed to insert agent_runs row');
  });

  it('only sets status when the patch has nothing else', async () => {
    const { fake, store } = dbStore();
    await store.update('run-1', { status: 'running' });
    expect(setOf(fake)).toEqual({ status: 'running' });
  });

  it('copies every provided usage and metadata field', async () => {
    const { fake, store } = dbStore();
    const d = new Date('2026-01-01T00:00:00Z');
    await store.update('run-1', {
      status: 'done', tokensIn: 1, tokensOut: 0, cacheRead: 2, cacheCreation: 3, costUsd: 0.1,
      counts: { n: 1 }, error: 'e', outputSummary: 's', startedAt: d, finishedAt: d,
    });
    expect(setOf(fake)).toEqual({
      status: 'done', tokensIn: 1, tokensOut: 0, cacheRead: 2, cacheCreation: 3, costUsd: 0.1,
      counts: { n: 1 }, error: 'e', outputSummary: 's', startedAt: d, finishedAt: d,
    });
  });

  it('lists runs for a case', async () => {
    const { fake, store } = dbStore();
    fake.queue('select:agent_runs', [{ id: 'a' }, { id: 'b' }]);
    expect((await store.listByCase(CASE)).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
