import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';
import type { Resource } from '@/lib/contracts';
import type { EvidenceWithId } from '@/lib/agents/verifier';

const ingestEvidence = vi.fn(async () => []);
vi.mock('@/lib/case-docs/hooks', () => ({ ingestEvidence: (...a: unknown[]) => (ingestEvidence as (...x: unknown[]) => unknown)(...a) }));

const { DbPersist, MemoryPersist, resourceName } = await import('@/lib/agents/persist');
type RankedEntry = import('@/lib/agents/persist').RankedEntry;

const CASE = '00000000-0000-4000-8000-000000000001';
const FETCHED = '2026-01-01T00:00:00.000Z';
const ev = (id: string, sourceKind: EvidenceWithId['sourceKind'] = 'pubmed'): EvidenceWithId => ({
  id, claimType: 'publication', claim: `Claim ${id}`, sourceUrl: `https://example.org/${id}`, sourceKind, fetchedAt: FETCHED,
});
const entry = (resource: Resource, rank: number, evidence: EvidenceWithId[] = [], score = 10.6): RankedEntry => ({
  record: { resource, key: `${resource.kind}:${resource.id}`, evidence }, score, rank, breakdown: [],
});
const expert = (over: Partial<Extract<Resource, { kind: 'expert' }>> = {}): Resource => ({ kind: 'expert', id: 'x1', name: 'Dr Synthetic', evidenceRefs: [], ...over });
const inst = (over: Partial<Extract<Resource, { kind: 'institution' }>> = {}): Resource => ({ kind: 'institution', id: 'i1', name: 'Synthetic Center', evidenceRefs: [], ...over });
const trial = (over: Partial<Extract<Resource, { kind: 'trial' }>> = {}): Resource => ({ kind: 'trial', id: 't1', nctId: 'NCT00000001', title: 'Synthetic Trial', evidenceRefs: [], ...over });
const org = (over: Partial<Extract<Resource, { kind: 'organization' }>> = {}): Resource => ({ kind: 'organization', id: 'o1', name: 'Synthetic Org', organizationKind: 'advocacy', url: 'https://org.example', evidenceRefs: [], ...over });

function persistWith() {
  const fake = createChainDb();
  const persist = new DbPersist(fake.db as unknown as ConstructorParameters<typeof DbPersist>[0]);
  return { fake, persist };
}
const valuesOf = (call: { methods: Array<{ name: string; args: unknown[] }> }) => call.methods.find((m) => m.name === 'values')?.args[0] as Record<string, unknown> | Record<string, unknown>[];

beforeEach(() => ingestEvidence.mockClear());

describe('resourceName', () => {
  it('uses the title for trials and the name for every other kind', () => {
    expect(resourceName(trial())).toBe('Synthetic Trial');
    expect(resourceName(expert())).toBe('Dr Synthetic');
  });
});

describe('MemoryPersist', () => {
  it('returns empty lists for an unknown case', async () => {
    const p = new MemoryPersist();
    expect(await p.getShortlist(CASE)).toEqual([]);
    expect(await p.getShortlistMeta(CASE)).toEqual([]);
  });

  it('records nct id for trials, organization kind for orgs, and null for the rest', async () => {
    const p = new MemoryPersist();
    await p.saveResults(CASE, [
      entry(trial(), 1), entry(org(), 2), entry(org({ id: 'o2', organizationKind: undefined }), 3), entry(expert(), 4),
    ]);
    const meta = await p.getShortlistMeta(CASE);
    expect(meta.map((m) => [m.nctId, m.organizationKind])).toEqual([
      ['NCT00000001', null], [null, 'advocacy'], [null, null], [null, null],
    ]);
    expect(p.resources.size).toBe(4);
  });

  it('replaces the previous shortlist on a re-run and hands out copies', async () => {
    const p = new MemoryPersist();
    await p.saveResults(CASE, [entry(expert(), 1, [ev('e1')])]);
    await p.saveResults(CASE, [entry(trial(), 1)]);
    const list = await p.getShortlist(CASE);
    expect(list.map((i) => i.targetKind)).toEqual(['trial']);
    list.pop();
    expect(await p.getShortlist(CASE)).toHaveLength(1);
    expect(ingestEvidence).toHaveBeenCalledTimes(2);
  });
});

describe('DbPersist.saveResults', () => {
  it('upserts an institution with defaults, flags NCI designation from evidence, and maps its id', async () => {
    const { fake, persist } = persistWith();
    await persist.saveResults(CASE, [entry(inst(), 1, [ev('e1', 'nci')])]);
    const [call] = fake.callsFor('insert:institutions');
    expect(valuesOf(call)).toMatchObject({ kind: 'hospital', city: null, state: null, nciDesignated: true });
  });

  it('keeps explicit institution fields and marks non-NCI evidence as undesignated', async () => {
    const { fake, persist } = persistWith();
    await persist.saveResults(CASE, [entry(inst({ institutionKind: 'cancer_center', city: 'Austin', state: 'TX' }), 1, [ev('e1')])]);
    expect(valuesOf(fake.callsFor('insert:institutions')[0])).toMatchObject({ kind: 'cancer_center', city: 'Austin', state: 'TX', nciDesignated: false });
  });

  it('links an expert to an institution saved in the same run', async () => {
    const { fake, persist } = persistWith();
    fake.queue('insert:experts', [{ id: 'real-x1' }]);
    await persist.saveResults(CASE, [
      entry(inst(), 1),
      entry(expert({ institutionId: 'i1', npi: '1234567890', credentials: 'MD', specialty: 'Oncology', verified: true }), 2),
    ]);
    expect(valuesOf(fake.callsFor('insert:experts')[0])).toMatchObject({ institutionId: 'i1', npi: '1234567890', verified: true, credentials: 'MD' });
    const conflict = fake.callsFor('insert:experts')[0].methods.find((m) => m.name === 'onConflictDoUpdate');
    expect((conflict?.args[0] as { target: { name: string } }).target.name).toBe('npi');
  });

  it('nulls the institution link when the institution is not part of the run and conflicts on id without an NPI', async () => {
    const { fake, persist } = persistWith();
    await persist.saveResults(CASE, [entry(expert({ institutionId: 'missing' }), 1)]);
    expect(valuesOf(fake.callsFor('insert:experts')[0])).toMatchObject({ institutionId: null, npi: null, verified: false, credentials: null, specialty: null });
    const conflict = fake.callsFor('insert:experts')[0].methods.find((m) => m.name === 'onConflictDoUpdate');
    expect((conflict?.args[0] as { target: { name: string } }).target.name).toBe('id');
  });

  it('remaps candidate and evidence target ids to the row an existing NPI/NCT already owns', async () => {
    const { fake, persist } = persistWith();
    fake.queue('insert:experts', [{ id: 'db-expert' }]);
    fake.queue('insert:trials', [{ id: 'db-trial' }]);
    await persist.saveResults(CASE, [entry(expert(), 1, [ev('e1')]), entry(trial(), 2, [ev('e2')])]);
    const cands = valuesOf(fake.callsFor('insert:case_candidates')[0]) as Record<string, unknown>[];
    expect(cands.map((c) => c.targetId)).toEqual(['db-expert', 'db-trial']);
    expect(cands.map((c) => c.score)).toEqual([11, 11]);
    const evRows = fake.callsFor('insert:evidence').map(valuesOf) as Record<string, unknown>[];
    expect(evRows.map((r) => r.targetId)).toEqual(['db-expert', 'db-trial']);
  });

  it('falls back to the canonical id when an upsert returns no row, and stores a null trial status', async () => {
    const { fake, persist } = persistWith();
    await persist.saveResults(CASE, [entry(expert(), 1), entry(trial(), 2)]);
    expect(valuesOf(fake.callsFor('insert:trials')[0])).toMatchObject({ status: null });
    const cands = valuesOf(fake.callsFor('insert:case_candidates')[0]) as Record<string, unknown>[];
    expect(cands.map((c) => c.targetId)).toEqual(['x1', 't1']);
  });

  it('upserts organizations with default kind and null url', async () => {
    const { fake, persist } = persistWith();
    await persist.saveResults(CASE, [entry(org({ organizationKind: undefined, url: undefined }), 1)]);
    expect(valuesOf(fake.callsFor('insert:organizations')[0])).toMatchObject({ kind: 'advocacy', url: null });
  });

  it('clears old candidates but inserts none for an empty result', async () => {
    const { fake, persist } = persistWith();
    await persist.saveResults(CASE, []);
    expect(fake.callsFor('delete:case_candidates')).toHaveLength(1);
    expect(fake.callsFor('insert:case_candidates')).toHaveLength(0);
    expect(ingestEvidence).toHaveBeenCalledWith(CASE, [], undefined);
  });
});

describe('DbPersist.getShortlist', () => {
  const cand = (targetKind: string, targetId: string, extra: Record<string, unknown> = {}) => ({
    id: `c-${targetId}`, caseId: CASE, targetKind, targetId, rank: 1, score: 5, selected: false, scoreBreakdown: [], ...extra,
  });

  it('returns nothing when the case has no candidates', async () => {
    const { fake, persist } = persistWith();
    expect(await persist.getShortlist(CASE)).toEqual([]);
    expect(fake.callsFor('select:evidence')).toHaveLength(0);
  });

  it('names every kind, falls back for unknowns, defaults nulls and sorts by kind then rank', async () => {
    const { fake, persist } = persistWith();
    fake.queue('select:case_candidates', [
      cand('trial', 't1', { rank: 2 }),
      cand('expert', 'x2', { rank: 2 }),
      cand('expert', 'x1', { rank: 1 }),
      cand('institution', 'i1', { rank: null, score: null, scoreBreakdown: null, selected: true }),
      cand('organization', 'o-missing'),
    ]);
    fake.queue('select:experts', [{ id: 'x1', name: 'Expert One' }]);
    fake.queue('select:institutions', [{ id: 'i1', name: 'Inst One' }]);
    fake.queue('select:trials', [{ id: 't1', title: 'Trial One' }]);
    fake.queue('select:organizations', []);
    fake.queue('select:evidence', [
      { id: 'e1', targetId: 'x1', targetKind: 'expert', claimType: 'publication', claim: 'c', sourceUrl: 'https://e.example', sourceKind: 'pubmed', fetchedAt: new Date(FETCHED) },
      { id: 'e2', targetId: 'x1', targetKind: 'trial', claimType: 'x', claim: 'other kind', sourceUrl: 'https://e.example', sourceKind: 'ctgov', fetchedAt: new Date(FETCHED) },
    ]);
    const list = await persist.getShortlist(CASE);
    expect(list.map((i) => [i.targetKind, i.targetId, i.name])).toEqual([
      ['expert', 'x1', 'Expert One'], ['expert', 'x2', '(unknown)'], ['institution', 'i1', 'Inst One'],
      ['organization', 'o-missing', '(unknown)'], ['trial', 't1', 'Trial One'],
    ]);
    const inst1 = list.find((i) => i.targetId === 'i1');
    expect(inst1).toMatchObject({ rank: 0, score: 0, breakdown: [], selected: true });
    expect(list[0].evidence).toEqual([expect.objectContaining({ id: 'e1', fetchedAt: FETCHED })]);
    expect(list.find((i) => i.targetKind === 'trial')?.evidence).toEqual([]);
  });
});

describe('DbPersist.getShortlistMeta', () => {
  it('returns nothing when the case has no candidates', async () => {
    const { persist } = persistWith();
    expect(await persist.getShortlistMeta(CASE)).toEqual([]);
  });

  it('attaches nct ids and organization kinds, and nulls for rows that vanished or other kinds', async () => {
    const { fake, persist } = persistWith();
    fake.queue('select:case_candidates', [
      { id: 'c1', targetKind: 'trial', targetId: 't1' }, { id: 'c2', targetKind: 'trial', targetId: 't-gone' },
      { id: 'c3', targetKind: 'organization', targetId: 'o1' }, { id: 'c4', targetKind: 'organization', targetId: 'o-gone' },
      { id: 'c5', targetKind: 'expert', targetId: 'x1' },
    ]);
    fake.queue('select:trials', [{ id: 't1', nctId: 'NCT00000002' }]);
    fake.queue('select:organizations', [{ id: 'o1', kind: 'travel_aid' }]);
    const meta = await persist.getShortlistMeta(CASE);
    expect(meta.map((m) => [m.caseCandidateId, m.nctId, m.organizationKind])).toEqual([
      ['c1', 'NCT00000002', null], ['c2', null, null], ['c3', null, 'travel_aid'], ['c4', null, null], ['c5', null, null],
    ]);
  });

  it('skips the lookups when there are no trial or organization candidates', async () => {
    const { fake, persist } = persistWith();
    fake.queue('select:case_candidates', [{ id: 'c1', targetKind: 'expert', targetId: 'x1' }]);
    await persist.getShortlistMeta(CASE);
    expect(fake.callsFor('select:trials')).toHaveLength(0);
    expect(fake.callsFor('select:organizations')).toHaveLength(0);
  });
});
