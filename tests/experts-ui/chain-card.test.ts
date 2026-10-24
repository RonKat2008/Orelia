import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpertChainCard } from '@/components/experts/ExpertChainCard';
import type { ExpertChain, ExpertTrace } from '@/lib/experts/contract';

const AT = '2026-01-01T00:00:00.000Z';
const paper = (pmid: string, title: string, journal: string | undefined, year: number) => ({ pmid, title, ...(journal ? { journal } : {}), year, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, evidenceId: `a${pmid}` });
const chain: ExpertChain = {
  id: 'ada-example', paper: paper('222', 'Newer paper', 'J Vasc Surg', 2025),
  papers: [paper('222', 'Newer paper', 'J Vasc Surg', 2025), paper('111', 'Older paper', undefined, 2021)],
  author: { name: 'Ada Example', expertId: 'e1', npi: null, evidenceIds: ['a222', 'a111'] },
  institution: { name: 'Northgate University', pageUrl: null, evidenceIds: [] },
  seesPatients: { verdict: 'unknown', text: 'Not confirmed.', evidenceIds: [] },
  consultation: { verdict: 'unknown', text: 'None found.', evidenceIds: [], url: null },
  howToReach: [],
};
const trace: ExpertTrace = {
  caseId: 'c', tracedAt: AT, chains: [chain],
  evidence: ['222', '111'].map((p) => ({ id: `a${p}`, claimType: 'experts.authorship', claim: `Ada Example is listed as an author of PMID ${p}.`, sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${p}/`, sourceKind: 'pubmed' as const, fetchedAt: AT, targetKind: 'expert' as const, targetId: 'e1' })),
};

describe('ExpertChainCard', () => {
  it('lists every paper of the author as "Title (Journal, Year)", newest first, each with its source', () => {
    const html = renderToStaticMarkup(createElement(ExpertChainCard, { chain, trace, index: 0 }));
    expect(html.indexOf('Newer paper (J Vasc Surg, 2025)')).toBeGreaterThan(-1);
    expect(html.indexOf('Older paper (2021)')).toBeGreaterThan(html.indexOf('Newer paper'));
    expect(html).toContain('https://pubmed.ncbi.nlm.nih.gov/111/');
    expect(html).toContain('2 papers');
    expect(html.match(/Ada Example<\/h3>/g)).toHaveLength(1);
    expect(html).toContain('Where they work');
    expect(html).toContain('How to reach them');
  });
  it('still renders a trace saved before grouping (single paper, no papers array)', () => {
    const old = { ...chain, papers: undefined };
    const html = renderToStaticMarkup(createElement(ExpertChainCard, { chain: old, trace, index: 0 }));
    expect(html).toContain('Newer paper (J Vasc Surg, 2025)');
    expect(html).toContain('1 paper');
  });
});
