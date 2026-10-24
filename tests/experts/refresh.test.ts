import { describe, expect, it, vi } from 'vitest';
import { MemoryPersist, type RankedEntry } from '@/lib/agents/persist';
import type { ExaPort, NppesPort, NppesProvider, PubmedPort } from '@/lib/agents/research/source-ports';
import type { VerifiedRecord } from '@/lib/agents/verifier';
import type { Resource } from '@/lib/contracts';
import { refreshResearch } from '@/lib/experts/refresh';
import type { TraceInput, TraceInputEvidence } from '@/lib/experts/trace';
import { canVerifyByPhone } from '@/components/shortlist/verify-model';

vi.mock('@/lib/case-docs/hooks', () => ({ ingestEvidence: async () => [] }));

const CASE = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-02-01T00:00:00.000Z');
const AT = NOW.toISOString();
const INST = 'Northgate University Medical Center';

const pubEv = (pmid: string) => ({ id: `ev-${pmid}`, claimType: 'disease_publications', claim: `Ada Example is listed as an author of PMID ${pmid}.`, sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, sourceKind: 'pubmed' as const, fetchedAt: AT });
const expert: Extract<Resource, { kind: 'expert' }> = { kind: 'expert', id: 'x1', name: 'Ada Example', npi: null, evidenceRefs: ['ev-111'] };
const inst: Extract<Resource, { kind: 'institution' }> = { kind: 'institution', id: 'i1', name: 'Northgate Genetics Clinic', evidenceRefs: ['ev-i'] };
const instEv = { id: 'ev-i', claimType: 'disease_program', claim: 'Genetics clinic', sourceUrl: 'https://northgate-genetics.example.org/clinic', sourceKind: 'exa' as const, fetchedAt: AT };

async function seeded(): Promise<MemoryPersist> {
  const p = new MemoryPersist();
  const ranked: RankedEntry[] = [{ record: { resource: inst, key: 'institution:name:northgate genetics clinic', evidence: [instEv] }, score: 5, rank: 1, breakdown: [] }];
  const research: VerifiedRecord[] = [{ resource: expert, key: 'expert:name:ada example', evidence: [pubEv('111')], shortlistEligibility: { eligible: false, reason: 'x' } }];
  await p.saveResults(CASE, ranked, research);
  return p;
}

const pubmed: PubmedPort = { searchAuthors: vi.fn(async () => [{ name: 'Ada Example', firstName: 'Ada', lastName: 'Example', paperCount: 2, recentPaperCount: 1,
  papers: [{ pmid: '111', title: 'Vascular outcomes in vEDS', journal: 'J Vasc Surg', year: 2025, affiliation: `Department of Genetics, ${INST}, Springfield, IL, USA. Electronic address: ada@example.org` }] }]) };
const provider: NppesProvider = { npi: '1234567890', firstName: 'Ada', lastName: 'Example', state: 'IL', city: 'Springfield',
  raw: { number: '1234567890', enumeration_type: 'NPI-1', basic: {}, taxonomies: [{ code: '207SG0201X', desc: 'Clinical Genetics (M.D.)', primary: true }],
    addresses: [{ address_purpose: 'LOCATION', city: 'Springfield', state: 'IL', telephone_number: '217-555-0100' }] } as never };
const nppes: NppesPort = { lookup: vi.fn(async () => ({ searchUrl: 'https://npiregistry.cms.hhs.gov/api/?x', providers: [provider] })) };
const exa: ExaPort = { search: vi.fn(async ({ query }: { query: string }) => (/Northgate Genetics Clinic/.test(query) && /new patient/.test(query)
  ? [{ url: 'https://northgate-genetics.example.org/appointments', title: 'Appointments', text: 'New patient appointments: 217-555-0142' }] : [])) };

function loader(p: MemoryPersist) {
  return async (caseId: string): Promise<TraceInput> => {
    const experts = await p.getCaseExperts(caseId);
    const evidence: TraceInputEvidence[] = experts.flatMap((x) => x.evidence.map((e) => ({ ...e, sourceKind: e.sourceKind as TraceInputEvidence['sourceKind'], targetKind: 'expert', targetId: x.id })));
    return { caseId, diseaseName: 'Vascular EDS', experts: experts.map((x) => ({ id: x.id, name: x.name, npi: x.npi })), evidence };
  };
}

describe('refreshResearch (existing case, no full re-run)', () => {
  it('stores affiliations and phones, then traces a complete chain', async () => {
    const p = await seeded();
    const saveTrace = vi.fn(async (t) => t);
    const r = (await refreshResearch(CASE, 'Vascular EDS', { persist: p, ports: { pubmed, nppes, exa, now: NOW }, loadTraceInput: loader(p), saveTrace }))!;
    expect(r.added.affiliations).toBe(1);
    expect(r.added.contactPoints).toBe(2);
    expect(r.added.papers).toBe(1);
    expect(r.trace.chains[0]!.papers).toMatchObject([{ pmid: '111', title: 'Vascular outcomes in vEDS', journal: 'J Vasc Surg', year: 2025 }]);

    const [x] = await p.getCaseExperts(CASE);
    const aff = x!.evidence.find((e) => e.claimType === 'identity.affiliation')!;
    expect(aff.sourceUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/111/');
    expect(aff.claim).not.toContain('@');
    expect(x!.evidence.some((e) => e.claimType === 'contact_point.voice.nppes_location_phone' && e.claim === '+12175550100')).toBe(true);

    const card = (await p.getShortlist(CASE)).find((i) => i.targetId === 'i1')!;
    expect(canVerifyByPhone({ resource: inst, evidence: card.evidence } as never)).toBe(true);

    const chain = r.trace.chains[0]!;
    expect(chain.institution.name).toBe(INST);
    expect(chain.seesPatients.verdict).toBe('yes');
    expect(chain.howToReach.some((h) => h.channel === 'voice')).toBe(true);
    expect(saveTrace).toHaveBeenCalledOnce();
  });

  it('is idempotent: a second refresh adds nothing new', async () => {
    const p = await seeded();
    const deps = { persist: p, ports: { pubmed, nppes, exa, now: NOW }, loadTraceInput: loader(p), saveTrace: async (t: never) => t };
    await refreshResearch(CASE, 'Vascular EDS', deps);
    const before = (await p.getCaseExperts(CASE))[0]!.evidence.length;
    const again = (await refreshResearch(CASE, 'Vascular EDS', deps))!;
    expect(again.added).toEqual({ affiliations: 0, contactPoints: 0, papers: 0 });
    expect((await p.getCaseExperts(CASE))[0]!.evidence.length).toBe(before);
  });

  it('never guesses between two PubMed namesakes', async () => {
    const p = await seeded();
    const twins: PubmedPort = { searchAuthors: async () => [
      { name: 'Ada Example', firstName: 'Ada', lastName: 'Example', paperCount: 1, recentPaperCount: 1, papers: [{ pmid: '111', title: 'a', affiliation: `${INST}` }] },
      { name: 'Ada Example', firstName: 'Ada', lastName: 'Example', paperCount: 1, recentPaperCount: 1, papers: [{ pmid: '222', title: 'b', affiliation: 'Other University' }] },
    ] };
    const r = (await refreshResearch(CASE, 'Vascular EDS', { persist: p, ports: { pubmed: twins, nppes, exa, now: NOW }, loadTraceInput: loader(p), saveTrace: async (t) => t }))!;
    expect(r.added.affiliations).toBe(0);
  });

  it('stores no paper title when the namesake is ambiguous', async () => {
    const p = await seeded();
    const twins: PubmedPort = { searchAuthors: async () => [
      { name: 'Ada Example', firstName: 'Ada', lastName: 'Example', paperCount: 1, recentPaperCount: 1, papers: [{ pmid: '111', title: 'a' }] },
      { name: 'Ada Example', firstName: 'Ada', lastName: 'Example', paperCount: 1, recentPaperCount: 1, papers: [{ pmid: '222', title: 'b' }] },
    ] };
    const r = (await refreshResearch(CASE, 'Vascular EDS', { persist: p, ports: { pubmed: twins, nppes, exa, now: NOW }, loadTraceInput: loader(p), saveTrace: async (t) => t }))!;
    expect(r.added.papers).toBe(0);
    expect(r.trace.chains[0]!.papers![0]!.title).toBe('PubMed article 111');
  });
});
