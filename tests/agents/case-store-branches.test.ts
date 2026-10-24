import { describe, expect, it } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';
import { DbCaseStore, MemoryCaseStore } from '@/lib/agents/case-store';
import type { CaseInput } from '@/lib/contracts';

const input: CaseInput = { diseaseName: 'Synthetic disease', goals: ['second_opinion'] } as CaseInput;
const fullInput = {
  ...input, diseaseCodes: ['D-1'], subtype: 'sub', stageSummary: 'stage', homeCity: 'Austin', homeState: 'TX',
  insurer: 'Synthetic Health', planId: 'plan-1', travelLimitMiles: 120,
} as CaseInput;
const CREATED = new Date('2026-01-02T03:04:05.000Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'case-1', status: 'draft', createdAt: CREATED, diseaseName: 'Synthetic disease', diseaseCodes: null, subtype: null,
  stageSummary: null, homeCity: null, homeState: null, insurer: null, planId: null, travelLimitMiles: null, goals: null, ...over,
});
const dbStore = () => {
  const fake = createChainDb();
  return { fake, store: new DbCaseStore(fake.db as unknown as ConstructorParameters<typeof DbCaseStore>[0]) };
};

describe('DbCaseStore', () => {
  it('maps null columns to undefined optionals and null goals to an empty list', async () => {
    const { fake, store } = dbStore();
    fake.queue('insert:cases', [row()]);
    const created = await store.create(input);
    expect(created).toEqual({ id: 'case-1', status: 'draft', createdAt: CREATED.toISOString(), diseaseName: 'Synthetic disease', goals: [] });
    expect(created.homeCity).toBeUndefined();
  });

  it('writes nulls for omitted optionals and the requested status on create', async () => {
    const { fake, store } = dbStore();
    fake.queue('insert:cases', [row({ status: 'confirmed' })]);
    await store.create(input, 'confirmed');
    const values = fake.callsFor('insert:cases')[0].methods.find((m) => m.name === 'values')?.args[0];
    expect(values).toMatchObject({ status: 'confirmed', subtype: null, travelLimitMiles: null, diseaseCodes: null });
  });

  it('round-trips populated optional fields', async () => {
    const { fake, store } = dbStore();
    fake.queue('select:cases', [row({ diseaseCodes: ['D-1'], subtype: 'sub', homeCity: 'Austin', travelLimitMiles: 120, goals: ['x'] })]);
    const got = await store.get('case-1');
    expect(got).toMatchObject({ diseaseCodes: ['D-1'], subtype: 'sub', homeCity: 'Austin', travelLimitMiles: 120, goals: ['x'] });
  });

  it('throws when the insert returns no row', async () => {
    const { store } = dbStore();
    await expect(store.create(input)).rejects.toThrow('Failed to insert case');
  });

  it('returns null for a missing case on get and update', async () => {
    const { store } = dbStore();
    expect(await store.get('nope')).toBeNull();
    expect(await store.update('nope', fullInput, 'confirmed')).toBeNull();
  });

  it('returns the updated case', async () => {
    const { fake, store } = dbStore();
    fake.queue('update:cases', [row({ status: 'confirmed' })]);
    expect((await store.update('case-1', fullInput, 'confirmed'))?.status).toBe('confirmed');
  });

  it('claims a case only when exactly one row matched', async () => {
    const { fake, store } = dbStore();
    fake.queue('update:cases', [{ id: 'case-1' }], []);
    expect(await store.compareAndSetStatus('case-1', ['confirmed'], 'running')).toBe(true);
    expect(await store.compareAndSetStatus('case-1', ['confirmed'], 'running')).toBe(false);
  });

  it('sets status with a plain update', async () => {
    const { fake, store } = dbStore();
    await store.setStatus('case-1', 'done');
    expect(fake.callsFor('update:cases')).toHaveLength(1);
  });
});

describe('MemoryCaseStore', () => {
  it('creates with the default draft status and a unique id', async () => {
    const store = new MemoryCaseStore();
    const a = await store.create(input);
    const b = await store.create(input);
    expect(a.status).toBe('draft');
    expect(a.id).not.toBe(b.id);
  });

  it('returns null from get and update for an unknown case', async () => {
    const store = new MemoryCaseStore();
    expect(await store.get('nope')).toBeNull();
    expect(await store.update('nope', input, 'confirmed')).toBeNull();
  });

  it('update replaces fields but keeps id and createdAt', async () => {
    const store = new MemoryCaseStore();
    const c = await store.create(fullInput);
    const next = await store.update(c.id, input, 'confirmed');
    expect(next).toMatchObject({ id: c.id, createdAt: c.createdAt, status: 'confirmed' });
    expect(next?.homeCity).toBeUndefined();
  });

  it('compareAndSetStatus refuses unknown cases and unexpected statuses, accepts expected ones', async () => {
    const store = new MemoryCaseStore();
    const c = await store.create(input, 'confirmed');
    expect(await store.compareAndSetStatus('nope', ['confirmed'], 'running')).toBe(false);
    expect(await store.compareAndSetStatus(c.id, ['draft'], 'running')).toBe(false);
    expect(await store.compareAndSetStatus(c.id, ['confirmed'], 'running')).toBe(true);
    expect((await store.get(c.id))?.status).toBe('running');
    expect(await store.compareAndSetStatus(c.id, ['confirmed'], 'done')).toBe(false);
  });

  it('setStatus changes known cases and ignores unknown ones', async () => {
    const store = new MemoryCaseStore();
    const c = await store.create(input);
    await store.setStatus(c.id, 'done');
    await store.setStatus('nope', 'done');
    expect((await store.get(c.id))?.status).toBe('done');
    expect(await store.get('nope')).toBeNull();
  });
});
