import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';
import { makePlan } from './plan-fixture';

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const { getPlanStore, MemoryPlanStore, PostgresPlanStore, setPlanStoreForTests } = await import('@/lib/plan/store');

const CASE = 'case-store-branches';
const withDb = () => {
  const fake = createChainDb();
  holder.db = fake.db;
  return { fake, store: new PostgresPlanStore() };
};
const setOf = (fake: ReturnType<typeof createChainDb>, key: string) =>
  fake.callsFor(key)[0].methods.find((m) => m.name === 'set' || m.name === 'values')?.args[0] as Record<string, unknown>;

afterEach(() => { setPlanStoreForTests(undefined); vi.unstubAllEnvs(); });

describe('MemoryPlanStore', () => {
  it('returns null when nothing was saved', async () => {
    expect(await new MemoryPlanStore().latest(CASE)).toBeNull();
  });

  it('refuses to save a plan that fails schema validation', async () => {
    const store = new MemoryPlanStore();
    expect(await store.save({ ...makePlan(CASE), summary: '' })).toBeNull();
    expect(await store.latest(CASE)).toBeNull();
  });

  it('enforces the expected version on update', async () => {
    const store = new MemoryPlanStore();
    await store.save(makePlan(CASE));
    expect(await store.save(makePlan(CASE, { version: 2 }), 7)).toBeNull();
    expect((await store.latest(CASE))?.version).toBe(1);
    expect((await store.save(makePlan(CASE, { version: 2 }), 1))?.version).toBe(2);
  });

  it('rejects a versioned save when there is no existing plan', async () => {
    expect(await new MemoryPlanStore().save(makePlan(CASE), 1)).toBeNull();
  });

  it('hands out copies so callers cannot mutate stored state', async () => {
    const store = new MemoryPlanStore();
    await store.save(makePlan(CASE));
    const got = await store.latest(CASE);
    got!.summary = 'mutated';
    expect((await store.latest(CASE))?.summary).not.toBe('mutated');
  });
});

describe('PostgresPlanStore', () => {
  it('latest returns the parsed plan, or null for no row or a corrupt stored plan', async () => {
    const { fake, store } = withDb();
    fake.queue('select:contact_plans', [{ plan: makePlan(CASE) }], [], [{ plan: { nonsense: true } }]);
    expect((await store.latest(CASE))?.caseId).toBe(CASE);
    expect(await store.latest(CASE)).toBeNull();
    expect(await store.latest(CASE)).toBeNull();
  });

  it('refuses invalid plans without touching the database', async () => {
    const { fake, store } = withDb();
    expect(await store.save({ ...makePlan(CASE), summary: '' })).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('versioned save succeeds only when exactly one row matched', async () => {
    const { fake, store } = withDb();
    fake.queue('update:contact_plans', [{ caseId: CASE }], []);
    expect(await store.save(makePlan(CASE, { version: 2 }), 1)).toMatchObject({ version: 2 });
    expect(await store.save(makePlan(CASE, { version: 2 }), 1)).toBeNull();
  });

  it('writes approvedAt as a Date when approved and null otherwise', async () => {
    const { fake, store } = withDb();
    const approvedAt = '2026-10-24T13:00:00.000Z';
    await store.save(makePlan(CASE, { status: 'approved', approvedAt }), 1);
    expect(setOf(fake, 'update:contact_plans').approvedAt).toEqual(new Date(approvedAt));
    await store.save(makePlan(CASE), 1);
    expect(fake.callsFor('update:contact_plans')[1].methods.find((m) => m.name === 'set')?.args[0]).toMatchObject({ approvedAt: null });
  });

  it('an unversioned save upserts with createdAt on insert', async () => {
    const { fake, store } = withDb();
    const plan = makePlan(CASE);
    expect(await store.save(plan)).toEqual(plan);
    expect(setOf(fake, 'insert:contact_plans')).toMatchObject({ caseId: CASE, createdAt: new Date(plan.createdAt) });
    expect(fake.callsFor('insert:contact_plans')[0].methods.some((m) => m.name === 'onConflictDoUpdate')).toBe(true);
  });
});

describe('getPlanStore', () => {
  it('is a memory singleton without DATABASE_URL', () => {
    vi.stubEnv('DATABASE_URL', '');
    const a = getPlanStore();
    expect(a).toBeInstanceOf(MemoryPlanStore);
    expect(getPlanStore()).toBe(a);
  });

  it('uses Postgres when DATABASE_URL is set and honours the test override', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic@localhost/synthetic');
    expect(getPlanStore()).toBeInstanceOf(PostgresPlanStore);
    const custom = new MemoryPlanStore();
    setPlanStoreForTests(custom);
    expect(getPlanStore()).toBe(custom);
  });
});
