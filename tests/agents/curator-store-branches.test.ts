import { afterEach, describe, expect, it } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';
import {
  computeSuggested, curationKey, DbCurationStore, getCurationStore, MAX_SUGGESTED, MemoryCurationStore,
} from '@/lib/agents/curator-store';
import type { RankedEntry } from '@/lib/agents/persist';
import type { ValidatedCuration } from '@/lib/agents/curator';
import type { Resource } from '@/lib/contracts';

const CASE = 'case-1';
const entry = (resource: Resource, rank: number): RankedEntry => ({
  record: { resource, key: `${resource.kind}:${resource.id}`, evidence: [] }, score: 1, rank, breakdown: [],
});
const exp = (id: string, extra: object = {}): Resource => ({ kind: 'expert', id, name: id, evidenceRefs: [], ...extra }) as Resource;
const org = (id: string): Resource => ({ kind: 'organization', id, name: id, organizationKind: 'advocacy', evidenceRefs: [] });
const trial = (id: string, nctId = 'NCT00000003'): Resource => ({ kind: 'trial', id, nctId, title: id, evidenceRefs: [] });
const inst = (id: string): Resource => ({ kind: 'institution', id, name: id, evidenceRefs: [] });

const curation = (tiers: ValidatedCuration['tiers'], over: Partial<ValidatedCuration> = {}): ValidatedCuration => ({
  tiers, summary: 'A summary.', suggested: [], dropped: [], source: 'model', ...over,
});
const tier = (candidateId: string, kind: Resource['kind'], t: ValidatedCuration['tiers'][number]['tier'] = 'best') => ({
  candidateId, kind, tier: t, reasons: [{ text: 'because', evidenceIds: ['e1'] }],
});

describe('computeSuggested', () => {
  it('orders best picks by kind then rank and caps at five', () => {
    const ranked = [entry(org('o1'), 1), entry(exp('x2'), 2), entry(exp('x1'), 1), entry(trial('t1'), 1), entry(inst('i1'), 1),
      entry(exp('x3'), 3), entry(exp('x4'), 4), entry(exp('x5'), 5)];
    const out = computeSuggested(ranked, () => 'best');
    expect(out).toHaveLength(MAX_SUGGESTED);
    expect(out.slice(0, 2)).toEqual(['expert:x1', 'expert:x2']);
  });

  it('ignores non-best tiers and honours a custom id mapper', () => {
    const ranked = [entry(exp('x1'), 1), entry(exp('x2'), 2)];
    const out = computeSuggested(ranked, (_k, id) => (id === 'real-x2' ? 'best' : 'good'), (e) => `real-${e.record.resource.id}`);
    expect(out).toEqual(['expert:real-x2']);
  });
});

describe('MemoryCurationStore', () => {
  it('returns null for an unknown case', async () => {
    expect(await new MemoryCurationStore().load(CASE)).toBeNull();
  });

  it("keeps the judge's own suggestions in order (any non-excluded tier), drops unknown ones, and copies reasons", async () => {
    const store = new MemoryCurationStore();
    const ranked = [entry(exp('x1'), 1), entry(exp('x2'), 2), entry(exp('x3'), 3)];
    const c = curation([tier('x1', 'expert'), tier('x2', 'expert', 'good'), tier('x3', 'expert', 'exclude')], { suggested: ['x2', 'x1', 'x3', 'ghost'] });
    await store.save(CASE, ranked, c);
    const loaded = await store.load(CASE);
    expect(loaded?.suggested).toEqual(['expert:x2', 'expert:x1']);
    expect(loaded?.byTarget.get('expert:x1')?.tierReasons).toEqual([{ text: 'because', evidenceIds: ['e1'] }]);
    loaded?.byTarget.get('expert:x1')?.tierReasons[0].evidenceIds.push('mutated');
    expect(c.tiers[0].reasons[0].evidenceIds).toEqual(['e1']);
  });

  it('stores a null summary when the curation summary is empty and caps suggestions', async () => {
    const store = new MemoryCurationStore();
    const ranked = Array.from({ length: 7 }, (_, i) => entry(exp(`x${i}`), i));
    const tiers = ranked.map((e) => tier(e.record.resource.id, 'expert'));
    await store.save(CASE, ranked, curation(tiers, { summary: '', suggested: ranked.map((e) => e.record.resource.id) }));
    const loaded = await store.load(CASE);
    expect(loaded?.summary).toBeNull();
    expect(loaded?.suggested).toHaveLength(MAX_SUGGESTED);
  });
});

describe('DbCurationStore.save', () => {
  const make = () => {
    const fake = createChainDb();
    return { fake, store: new DbCurationStore(fake.db as unknown as ConstructorParameters<typeof DbCurationStore>[0]) };
  };

  it('resolves real ids for NPI experts and trials, and uses canonical ids otherwise', async () => {
    const { fake, store } = make();
    fake.queue('execute', [{ id: 'real-expert' }], undefined, { rows: [{ id: 'real-trial' }] }, undefined, undefined);
    const ranked = [entry(exp('x1', { npi: '1234567890' }), 1), entry(exp('x2'), 2), entry(trial('t1'), 3), entry(org('o1'), 4)];
    await store.save(CASE, ranked, curation([tier('x1', 'expert'), tier('x2', 'expert'), tier('t1', 'trial'), tier('o1', 'organization')]));
    // lookups: expert npi, trial nct => 2 lookups + 4 updates = 6 executes
    expect(fake.callsFor('execute')).toHaveLength(6);
  });

  it('falls back to the canonical id when the lookup finds nothing or returns a non-string id', async () => {
    const { fake, store } = make();
    fake.queue('execute', [], { rows: [{ id: 42 }] }, 'garbage');
    const ranked = [entry(exp('x1', { npi: '1234567890' }), 1), entry(trial('t1'), 2)];
    await expect(store.save(CASE, ranked, curation([tier('x1', 'expert'), tier('t1', 'trial')]))).resolves.toBeUndefined();
  });

  it('tolerates a tier for an unknown candidate', async () => {
    const { fake, store } = make();
    await store.save(CASE, [], curation([tier('ghost', 'expert')]));
    expect(fake.callsFor('execute')).toHaveLength(1);
  });

  it('never writes a curator agent_runs row', async () => {
    const { fake, store } = make();
    await store.save(CASE, [], curation([]));
    expect(fake.callsFor('insert:agent_runs')).toHaveLength(0);
    expect(fake.callsFor('update:agent_runs')).toHaveLength(0);
  });

  it('stores the summary and the suggested picks under their real ids in coordination_records', async () => {
    const { fake, store } = make();
    fake.queue('execute', [{ id: 'real-x1' }]);
    const ranked = [entry(exp('x1', { npi: '1234567890' }), 1), entry(org('o1'), 2), entry(org('o2'), 3)];
    await store.save(CASE, ranked, curation([tier('x1', 'expert', 'good'), tier('o1', 'organization'), tier('o2', 'organization', 'exclude')], { suggested: ['o1', 'x1', 'o2'] }));
    const values = fake.callsFor('insert:coordination_records')[0].methods.find((m) => m.name === 'values')?.args[0];
    expect(values).toMatchObject({ caseId: CASE, kind: 'curation', key: 'current', data: { summary: 'A summary.', suggested: ['organization:o1', 'expert:real-x1'] } });
  });
});

describe('DbCurationStore.load', () => {
  const make = () => {
    const fake = createChainDb();
    return { fake, store: new DbCurationStore(fake.db as unknown as ConstructorParameters<typeof DbCurationStore>[0]) };
  };

  it('returns null when no candidate has a tier (array or {rows} result shapes, or garbage)', async () => {
    const { fake, store } = make();
    fake.queue('execute', [], { rows: [] }, { rows: 'nope' }, null);
    expect(await store.load(CASE)).toBeNull();
    expect(await store.load(CASE)).toBeNull();
    expect(await store.load(CASE)).toBeNull();
    expect(await store.load(CASE)).toBeNull();
  });

  it('rebuilds tiers, suggestions (kind then rank, capped) and the run summary', async () => {
    const { fake, store } = make();
    const rows = [
      { target_kind: 'organization', target_id: 'o1', rank: 1, tier: 'best', tier_reasons: null },
      { target_kind: 'expert', target_id: 'x2', rank: null, tier: 'best', tier_reasons: [{ text: 't', evidenceIds: [] }] },
      { target_kind: 'expert', target_id: 'x1', rank: 3, tier: 'best', tier_reasons: [] },
      { target_kind: 'trial', target_id: 't1', rank: 1, tier: 'good', tier_reasons: [] },
      ...Array.from({ length: 4 }, (_, i) => ({ target_kind: 'institution', target_id: `i${i}`, rank: i, tier: 'best', tier_reasons: [] })),
    ];
    fake.queue('execute', { rows });
    fake.queue('select:agent_runs', [{ outputSummary: 'Stored summary' }]);
    const loaded = await store.load(CASE);
    expect(loaded?.summary).toBe('Stored summary');
    expect(loaded?.suggested).toEqual(['expert:x2', 'expert:x1', 'institution:i0', 'institution:i1', 'institution:i2']);
    expect(loaded?.byTarget.get(curationKey('organization', 'o1'))?.tierReasons).toEqual([]);
    expect(loaded?.byTarget.get('trial:t1')?.tier).toBe('good');
  });

  it('prefers the stored curation record: its summary and suggestions in order, minus excluded or unknown ones', async () => {
    const { fake, store } = make();
    fake.queue('execute', [
      { target_kind: 'expert', target_id: 'x1', rank: 1, tier: 'good', tier_reasons: [] },
      { target_kind: 'organization', target_id: 'o1', rank: 2, tier: 'exclude', tier_reasons: [] },
    ]);
    fake.queue('select:coordination_records', [{ data: { summary: 'Judge summary', suggested: ['expert:x1', 'organization:o1', 'expert:ghost'] } }]);
    const loaded = await store.load(CASE);
    expect(loaded).toMatchObject({ summary: 'Judge summary', suggested: ['expert:x1'] });
  });

  it('reports a null summary when there is no curator run row', async () => {
    const { fake, store } = make();
    fake.queue('execute', [{ target_kind: 'expert', target_id: 'x1', rank: 1, tier: 'good', tier_reasons: [] }]);
    expect((await store.load(CASE))?.summary).toBeNull();
  });
});

describe('getCurationStore', () => {
  const g = globalThis as { __wayfinderCurations?: unknown };
  const saved = process.env.DATABASE_URL;
  afterEach(() => {
    delete g.__wayfinderCurations;
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  });

  it('is a memory singleton without DATABASE_URL', () => {
    delete g.__wayfinderCurations;
    delete process.env.DATABASE_URL;
    const a = getCurationStore();
    expect(a).toBeInstanceOf(MemoryCurationStore);
    expect(getCurationStore()).toBe(a);
  });

  it('builds the Postgres store when DATABASE_URL is set', () => {
    delete g.__wayfinderCurations;
    process.env.DATABASE_URL = 'postgres://synthetic:synthetic@localhost:5432/synthetic';
    expect(getCurationStore()).toBeInstanceOf(DbCurationStore);
  });
});
