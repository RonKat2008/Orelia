/**
 * Code-stamped paper citation rows. The PubMed tool record knows each paper's title, journal and year; this persists
 * them (claimType `publication.citation`, sourceUrl = that PubMed record) so the Experts tracer can show a real
 * citation after a reload. Models can never write this claim type (finalizeOutput drops it).
 */
import type { Evidence } from '@/lib/contracts/evidence';
import { cleanField } from '@/lib/agents/research/untrusted';
import { pubmedRecordUrl } from './affiliation-evidence';

export const PAPER_CLAIM_TYPE = 'publication.citation';
const MAX_TITLE = 300;
const MAX_JOURNAL = 120;
const PUBMED = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/$/;
const CLAIM = /^PMID (\d+) is titled "(.+)"(?: \((.+)\))?\.$/;

export interface PaperCitation { pmid: string; title: string; journal?: string; year?: number }

export function isPaperClaimType(claimType: string): boolean {
  return claimType.trim().toLowerCase() === PAPER_CLAIM_TYPE;
}

const tidy = (raw: string | undefined, max: number): string | null => {
  const t = cleanField(raw, max)?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return t && !/\[removed/i.test(t) ? t : null;
};

export function paperEvidence(input: { name: string; pmid: string; title: string | undefined; journal?: string; year?: number | null; fetchedAt: string }): (Evidence & { id: string }) | null {
  const title = tidy(input.title, MAX_TITLE)?.replace(/"/g, "'").replace(/[\s.]+$/, '');
  if (!title || !/^\d+$/.test(input.pmid)) return null;
  const journal = tidy(input.journal, MAX_JOURNAL)?.replace(/[()]/g, '');
  const year = input.year && input.year >= 1800 && input.year <= 2200 ? input.year : null;
  const slug = (cleanField(input.name, 120) ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return null;
  const tail = [journal, year].filter(Boolean).join(', ');
  return {
    id: `paper:${slug}:${input.pmid}`,
    claimType: PAPER_CLAIM_TYPE,
    claim: `PMID ${input.pmid} is titled "${title}"${tail ? ` (${tail})` : ''}.`,
    sourceUrl: pubmedRecordUrl(input.pmid),
    sourceKind: 'pubmed',
    fetchedAt: input.fetchedAt,
  };
}

/** Strict read-back: reserved claim type, PubMed source, and the claim's PMID must be the source record's PMID. */
export function parsePaperEvidence(e: { claimType: string; claim: string; sourceUrl: string; sourceKind?: string }): PaperCitation | null {
  if (!isPaperClaimType(e.claimType) || e.sourceKind !== 'pubmed') return null;
  const urlPmid = PUBMED.exec(e.sourceUrl)?.[1];
  const m = CLAIM.exec(e.claim);
  if (!urlPmid || !m || m[1] !== urlPmid) return null;
  const tail = m[3];
  const year = tail ? /(?:^|,\s*)(\d{4})$/.exec(tail)?.[1] : undefined;
  const journal = tail ? tail.replace(/(?:^|,\s*)\d{4}$/, '').trim() : '';
  return { pmid: urlPmid, title: m[2]!, ...(journal ? { journal } : {}), ...(year ? { year: Number(year) } : {}) };
}

/** "Title (Journal, Year)" for display; falls back gracefully when parts are missing. */
export function formatCitation(p: { title: string; journal?: string; year?: number }): string {
  const tail = [p.journal, p.year].filter(Boolean).join(', ');
  return tail ? `${p.title} (${tail})` : p.title;
}
