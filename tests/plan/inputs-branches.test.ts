import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';

const holder = vi.hoisted(() => ({ db: undefined as unknown, shortlist: [] as unknown[] }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));
vi.mock('@/app/api/cases/_lib/services', () => ({ getServices: () => ({ persist: { getShortlist: async () => holder.shortlist } }) }));

const { getPlanInputLoader, loadPlanInputs, MemoryPlanInputLoader, PostgresPlanInputLoader, setPlanInputLoaderForTests } = await import('@/lib/plan/inputs');

const CASE = 'case-inputs';
const evRow = (id: string) => ({ id, claimType: 'contact_point.email', claim: 'a@example.org', sourceUrl: 'https://example.org', sourceKind: 'exa', extra: 'dropped' });

afterEach(() => { setPlanInputLoaderForTests(undefined); vi.unstubAllEnvs(); });

describe('PostgresPlanInputLoader', () => {
  const setup = () => {
    const fake = createChainDb();
    holder.db = fake.db;
    return { fake, loader: new PostgresPlanInputLoader() };
  };

  it('returns nothing when no contacts or selected candidates exist', async () => {
    const { loader } = setup();
    expect(await loader.load(CASE)).toEqual([]);
  });

  it('dedupes contacts and candidates by target, keeping the contact id, and orders unranked candidates last', async () => {
    const { fake, loader } = setup();
    fake.queue('select:contacts',
      [{ id: 'c1', targetKind: 'expert', targetId: 'x1' }, { id: 'c1b', targetKind: 'expert', targetId: 'x1' }]);
    fake.queue('select:case_candidates', [
      { targetKind: 'organization', targetId: 'o-unranked', rank: null },
      { targetKind: 'organization', targetId: 'o-ranked', rank: 2 },
      { targetKind: 'expert', targetId: 'x1', rank: 1 },
    ]);
    fake.queue('select:experts', [{ name: 'Dr Synthetic' }]);
    fake.queue('select:organizations', [{ name: 'Ranked Org', kind: 'financial_aid' }], [{ name: 'Unranked Org', kind: 'advocacy' }]);
    fake.queue('select:evidence', [evRow('e1')], [], []);
    const out = await loader.load(CASE);
    expect(out.map((r) => [r.targetId, r.contactId, r.name, r.subKind])).toEqual([
      ['x1', 'c1', 'Dr Synthetic', null], ['o-ranked', null, 'Ranked Org', 'financial_aid'], ['o-unranked', null, 'Unranked Org', 'advocacy'],
    ]);
    expect(out[0].evidence).toEqual([{ id: 'e1', claimType: 'contact_point.email', claim: 'a@example.org', sourceUrl: 'https://example.org', sourceKind: 'exa' }]);
  });

  it('never adds demo evidence in demo mode: the planner sees only the real rows', async () => {
    vi.stubEnv('WAYFINDER_DEMO_COORDINATORS', '1');
    vi.stubEnv('OUTBOUND_ALLOWLIST', 'demo-a@example.org');
    vi.stubEnv('AGENTMAIL_SENDER_INBOX_ID', 'sender@example.org');
    const { fake, loader } = setup();
    fake.queue('select:contacts', [{ id: 'c1', targetKind: 'organization', targetId: 'o1', address: 'demo-a@example.org' }, { id: 'c2', targetKind: 'organization', targetId: 'o2', address: 'real@hospital.example' }]);
    fake.queue('select:case_candidates', []);
    fake.queue('select:organizations', [{ name: 'Org1', kind: 'advocacy' }], [{ name: 'Org2', kind: 'advocacy' }]);
    fake.queue('select:evidence', [], []);
    const out = await loader.load(CASE);
    expect(out[0].evidence).toEqual([]);
    expect(out[1].evidence).toEqual([]);
    expect(out[0]).not.toHaveProperty('address');
  });

  it('resolves institution, trial and missing-row names (falling back to the target id)', async () => {
    const { fake, loader } = setup();
    fake.queue('select:contacts', [
      { id: 'c1', targetKind: 'institution', targetId: 'i1' }, { id: 'c2', targetKind: 'trial', targetId: 't1' },
      { id: 'c3', targetKind: 'trial', targetId: 't-gone' }, { id: 'c4', targetKind: 'institution', targetId: 'i-gone' },
      { id: 'c5', targetKind: 'expert', targetId: 'x-gone' }, { id: 'c6', targetKind: 'organization', targetId: 'o-gone' },
    ]);
    fake.queue('select:institutions', [{ name: 'Inst', kind: 'cancer_center' }], []);
    fake.queue('select:trials', [{ name: 'Trial' }], []);
    const out = await loader.load(CASE);
    expect(out.map((r) => [r.targetId, r.name, r.subKind])).toEqual([
      ['i1', 'Inst', 'cancer_center'], ['t1', 'Trial', null], ['t-gone', 't-gone', null],
      ['i-gone', 'i-gone', null], ['x-gone', 'x-gone', null], ['o-gone', 'o-gone', null],
    ]);
  });
});

describe('MemoryPlanInputLoader', () => {
  it('maps only selected shortlist items and strips them of contact ids', async () => {
    holder.shortlist = [
      { targetKind: 'expert', targetId: 'x1', name: 'Dr A', selected: true, evidence: [{ id: 'e1', claimType: 'c', claim: 'cl', sourceUrl: 'https://e.example', sourceKind: 'exa', fetchedAt: 'x' }] },
      { targetKind: 'trial', targetId: 't1', name: 'Trial', selected: false, evidence: [] },
    ];
    const out = await new MemoryPlanInputLoader().load(CASE);
    expect(out).toEqual([{
      targetKind: 'expert', targetId: 'x1', name: 'Dr A', contactId: null, subKind: null,
      evidence: [{ id: 'e1', claimType: 'c', claim: 'cl', sourceUrl: 'https://e.example', sourceKind: 'exa' }],
    }]);
  });

  it('returns an empty list when nothing is selected', async () => {
    holder.shortlist = [];
    expect(await new MemoryPlanInputLoader().load(CASE)).toEqual([]);
  });
});

describe('getPlanInputLoader', () => {
  it('chooses by DATABASE_URL, memoises, and honours the test override', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const mem = getPlanInputLoader();
    expect(mem).toBeInstanceOf(MemoryPlanInputLoader);
    expect(getPlanInputLoader()).toBe(mem);
    setPlanInputLoaderForTests(undefined);
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic@localhost/synthetic');
    expect(getPlanInputLoader()).toBeInstanceOf(PostgresPlanInputLoader);
    const custom = { load: async () => [] };
    setPlanInputLoaderForTests(custom);
    expect(await loadPlanInputs(CASE)).toEqual([]);
    expect(getPlanInputLoader()).toBe(custom);
  });
});
