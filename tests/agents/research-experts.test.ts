import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';
import type { Resource, ResearchResult } from '@/lib/contracts';
import type { EvidenceWithId, VerifiedRecord } from '@/lib/agents/verifier';

/**
 * Experts below the shortlist threshold (unverified NPI, or too few disease papers) stay research: they never become
 * case candidates, but their verified publication evidence is kept so the Experts page can trace paper -> author.
 * Regression for the live vEDS case where literature kept 6 records and the trace had nothing to follow.
 */
const ingestEvidence = vi.fn(async () => []);
vi.mock('@/lib/case-docs/hooks', () => ({ ingestEvidence: (...a: unknown[]) => (ingestEvidence as (...x: unknown[]) => unknown)(...a) }));

const { DbPersist, MemoryPersist } = await import('@/lib/agents/persist');
const { runResearch } = await import('@/lib/agents/orchestrator');
const { MemoryCaseStore } = await import('@/lib/agents/case-store');
const { MemoryRunStore } = await import('@/lib/agents/run-store');
type RankedEntry = import('@/lib/agents/persist').RankedEntry;

const CASE = '00000000-0000-4000-8000-000000000001';
const FETCHED = '2026-01-01T00:00:00.000Z';
const pubmedEv = (id: string, pmid: string, name = 'Ada Example'): EvidenceWithId => ({
  id, claimType: 'disease_publications', claim: `${name} is listed as an author of PMID ${pmid}.`,
  sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, sourceKind: 'pubmed', fetchedAt: FETCHED,
});
const expert = (over: Partial<Extract<Resource, { kind: 'expert' }>> = {}): Extract<Resource, { kind: 'expert' }> => ({
  kind: 'expert', id: 'x-research', name: 'Ada Example', evidenceRefs: [], profile: { paperCount: 1, recentPaperCount: 1, affiliation: 'Example University, Portland, OR', state: 'OR' }, ...over,
});
const research = (r = expert(), evidence = [pubmedEv('e-r1', '111')]): VerifiedRecord => ({
  resource: r, key: `expert:name:${r.name}`, evidence, shortlistEligibility: { eligible: false, reason: 'identity not verified' },
});
const inst: Resource = { kind: 'institution', id: 'i1', name: 'Synthetic Center', evidenceRefs: [] };
const ranked = (resource: Resource, evidence: EvidenceWithId[] = []): RankedEntry => ({
  record: { resource, key: `${resource.kind}:${resource.id}`, evidence }, score: 5, rank: 1, breakdown: [],
});

beforeEach(() => ingestEvidence.mockClear());

describe('MemoryPersist research experts', () => {
  it('keeps research-only experts out of the shortlist but returns them with their evidence', async () => {
    const p = new MemoryPersist();
    await p.saveResults(CASE, [ranked(inst)], [research()]);
    expect((await p.getShortlist(CASE)).map((i) => i.targetKind)).toEqual(['institution']);
    const experts = await p.getCaseExperts(CASE);
    expect(experts).toEqual([expect.objectContaining({ id: 'x-research', name: 'Ada Example', npi: null, profile: expect.objectContaining({ paperCount: 1 }) })]);
    expect(experts[0].evidence.map((e) => e.sourceUrl)).toEqual(['https://pubmed.ncbi.nlm.nih.gov/111/']);
    // research evidence is not ingested into the outreach document store
    expect(ingestEvidence).toHaveBeenCalledWith(CASE, [], undefined);
  });

  it('includes shortlisted experts and replaces the list on a re-run', async () => {
    const p = new MemoryPersist();
    const shortlisted = expert({ id: 'x-short', name: 'Bo Verified', npi: '1234567890', verified: true });
    await p.saveResults(CASE, [ranked(shortlisted, [pubmedEv('e-s', '222', 'Bo Verified')])], [research()]);
    expect((await p.getCaseExperts(CASE)).map((e) => [e.id, e.npi])).toEqual([['x-short', '1234567890'], ['x-research', null]]);
    await p.saveResults(CASE, []);
    expect(await p.getCaseExperts(CASE)).toEqual([]);
  });
});

describe('DbPersist research experts', () => {
  const persistWith = () => {
    const fake = createChainDb();
    return { fake, persist: new DbPersist(fake.db as unknown as ConstructorParameters<typeof DbPersist>[0]) };
  };
  const valuesOf = (call: { methods: Array<{ name: string; args: unknown[] }> }) => call.methods.find((m) => m.name === 'values')?.args[0] as Record<string, unknown> | Record<string, unknown>[];

  it('upserts the research expert and its evidence, with paper counts, but no candidate row', async () => {
    const { fake, persist } = persistWith();
    fake.queue('insert:experts', [{ id: 'db-research' }]);
    await persist.saveResults(CASE, [ranked(inst)], [research()]);
    expect(valuesOf(fake.callsFor('insert:experts')[0])).toMatchObject({ name: 'Ada Example', npi: null, verified: false, diseasePaperCount: 1, recentPaperCount: 1 });
    const evRows = fake.callsFor('insert:evidence').map(valuesOf) as Record<string, unknown>[];
    expect(evRows).toEqual([expect.objectContaining({ id: 'e-r1', caseId: CASE, targetKind: 'expert', targetId: 'db-research', sourceKind: 'pubmed' })]);
    const cands = valuesOf(fake.callsFor('insert:case_candidates')[0]) as Record<string, unknown>[];
    expect(cands.map((c) => c.targetKind)).toEqual(['institution']);
    expect(ingestEvidence).toHaveBeenCalledWith(CASE, [], undefined);
  });

  it('reads every expert with case-scoped evidence, with name, NPI and counts', async () => {
    const { fake, persist } = persistWith();
    fake.queue('select:evidence', [
      { id: 'e1', caseId: CASE, targetId: 'x1', targetKind: 'expert', claimType: 'disease_publications', claim: 'c1', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/111/', sourceKind: 'pubmed', fetchedAt: new Date(FETCHED) },
      { id: 'e2', caseId: CASE, targetId: 'x-gone', targetKind: 'expert', claimType: 'disease_publications', claim: 'c2', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/222/', sourceKind: 'pubmed', fetchedAt: new Date(FETCHED) },
    ]);
    fake.queue('select:experts', [{ id: 'x1', name: 'Ada Example', npi: null, diseasePaperCount: 3, recentPaperCount: 2 }]);
    const experts = await persist.getCaseExperts(CASE);
    expect(experts).toEqual([{
      id: 'x1', name: 'Ada Example', npi: null, profile: { paperCount: 3, recentPaperCount: 2 },
      evidence: [{ id: 'e1', claimType: 'disease_publications', claim: 'c1', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/111/', sourceKind: 'pubmed', fetchedAt: FETCHED }],
    }]);
  });

  it('skips the expert lookup when the case has no expert evidence', async () => {
    const { fake, persist } = persistWith();
    expect(await persist.getCaseExperts(CASE)).toEqual([]);
    expect(fake.callsFor('select:experts')).toHaveLength(0);
  });
});

describe('runResearch keeps ineligible experts as research', () => {
  it('persists a below-threshold literature expert for tracing without shortlisting it', async () => {
    const cases = new MemoryCaseStore();
    const persist = new MemoryPersist();
    const c = await cases.create({ diseaseName: 'X', goals: [] }, 'confirmed');
    const lit: ResearchResult = {
      status: 'ok',
      records: [{ kind: 'expert', id: 'expert:ada-example', name: 'Ada Example', evidenceRefs: ['https://pubmed.ncbi.nlm.nih.gov/111/'] }],
      evidence: [{ claimType: 'disease_publications', claim: 'Ada Example is listed as an author of PMID 111.', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/111/', sourceKind: 'pubmed', fetchedAt: FETCHED }],
    };
    const summary = await runResearch(c.id, {
      store: new MemoryRunStore(), persist, cases, ports: {} as never,
      agents: [{ name: 'literature', model: 'claude-haiku-5-5', run: async () => lit }],
    });
    expect(summary.candidates).toBe(0);
    expect(await persist.getShortlist(c.id)).toEqual([]);
    const experts = await persist.getCaseExperts(c.id);
    expect(experts.map((e) => e.name)).toEqual(['Ada Example']);
    expect(experts[0].evidence.map((e) => e.sourceKind)).toEqual(['pubmed']);
  });
});

describe('loadTraceInput', () => {
  it('traces research experts even when the shortlist has no expert', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { getServices } = await import('@/app/api/cases/_lib/services');
      const { loadTraceInput } = await import('@/lib/experts/wiring');
      const { cases, persist } = getServices();
      const c = await cases.create({ diseaseName: 'vascular Ehlers-Danlos syndrome', goals: [], homeState: 'OH' } as never, 'confirmed');
      await persist.saveResults(c.id, [ranked(inst)], [research()]);
      const input = await loadTraceInput(c.id);
      expect(input?.experts).toEqual([expect.objectContaining({ id: 'x-research', name: 'Ada Example', npi: null, profile: expect.objectContaining({ affiliation: 'Example University, Portland, OR' }) })]);
      expect(input?.evidence.filter((e) => e.targetKind === 'expert').map((e) => [e.targetId, e.sourceKind])).toEqual([['x-research', 'pubmed']]);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
