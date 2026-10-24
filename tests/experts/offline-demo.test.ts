import { describe, expect, it } from 'vitest';
import { createFixturePorts } from '@/lib/agents/research/fixture-ports';
import { createFixtureExpertPorts } from '@/lib/experts/fixtures';
import { traceExperts, type TraceInputEvidence } from '@/lib/experts/trace';

describe('offline demo fixtures', () => {
  it('yields at least two complete chains for the recorded epithelioid sarcoma case', async () => {
    const hits = await createFixturePorts().pubmed.searchAuthors({ disease: 'epithelioid sarcoma', limit: 12 });
    const experts = hits.map((h) => ({ id: `expert:${h.name}`, name: h.name, profile: { paperCount: h.paperCount, recentPaperCount: h.recentPaperCount, affiliation: h.affiliation, state: h.state } }));
    const evidence: TraceInputEvidence[] = hits.flatMap((h) => h.papers.map((p) => ({
      targetKind: 'expert', targetId: `expert:${h.name}`, claimType: 'authorship', claim: `${h.name} is listed as an author of PMID ${p.pmid}.`,
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`, sourceKind: 'pubmed' as const, fetchedAt: '2026-01-01T00:00:00.000Z',
    })));
    const trace = await traceExperts({ caseId: 'demo', diseaseName: 'epithelioid sarcoma', experts, evidence }, { ...createFixtureExpertPorts(), now: new Date('2026-01-02T00:00:00.000Z') });
    const complete = trace.chains.filter((c) => c.institution.name && c.seesPatients.verdict === 'yes' && c.consultation.verdict === 'yes');
    expect(complete.length).toBeGreaterThanOrEqual(2);
  });
});
