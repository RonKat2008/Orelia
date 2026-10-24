import { describe, expect, it } from 'vitest';
import { formatCitation, paperEvidence, parsePaperEvidence } from '@/lib/identity/paper-evidence';

const base = { name: 'Ada Example', pmid: '41616879', title: 'Vascular outcomes in vEDS', journal: 'J Vasc Surg', year: 2025, fetchedAt: '2026-01-01T00:00:00.000Z' };

describe('paper citation evidence', () => {
  it('round-trips title, journal and year, sourced to the PubMed record', () => {
    const row = paperEvidence(base)!;
    expect(row.id).toBe('paper:ada-example:41616879');
    expect(row.sourceUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/41616879/');
    expect(parsePaperEvidence(row)).toEqual({ pmid: '41616879', title: 'Vascular outcomes in vEDS', journal: 'J Vasc Surg', year: 2025 });
  });
  it('works with only a year or only a title', () => {
    expect(parsePaperEvidence(paperEvidence({ ...base, journal: undefined })!)).toEqual({ pmid: '41616879', title: 'Vascular outcomes in vEDS', year: 2025 });
    expect(parsePaperEvidence(paperEvidence({ ...base, journal: undefined, year: null })!)).toEqual({ pmid: '41616879', title: 'Vascular outcomes in vEDS' });
  });
  it('needs a title and a numeric PMID, strips markup and quotes', () => {
    expect(paperEvidence({ ...base, title: '  ' })).toBeNull();
    expect(paperEvidence({ ...base, pmid: 'abc' })).toBeNull();
    expect(parsePaperEvidence(paperEvidence({ ...base, title: 'A <i>COL3A1</i> "study".' })!)?.title).toBe("A COL3A1 'study'");
  });
  it('rejects rows whose PMID differs from the source record or whose source is not PubMed', () => {
    const row = paperEvidence(base)!;
    expect(parsePaperEvidence({ ...row, sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/999/' })).toBeNull();
    expect(parsePaperEvidence({ ...row, sourceKind: 'exa' })).toBeNull();
    expect(parsePaperEvidence({ ...row, claimType: 'other' })).toBeNull();
  });
  it('formats as Title (Journal, Year)', () => {
    expect(formatCitation({ title: 'T', journal: 'J', year: 2024 })).toBe('T (J, 2024)');
    expect(formatCitation({ title: 'T', year: 2024 })).toBe('T (2024)');
    expect(formatCitation({ title: 'T' })).toBe('T');
  });
});
