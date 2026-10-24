/**
 * Code-stamped author affiliation rows. The literature agent's PubMed tool sees each author's affiliation on each
 * paper; this persists it as an evidence row (claimType `identity.affiliation`, sourceUrl = that PubMed record) so the
 * Experts tracer can follow paper -> author -> institution after a reload. Models can never write this claim type
 * (finalizeOutput drops it); the claim text is built here from the tool record only.
 */
import type { Evidence } from '@/lib/contracts/evidence';
import { cleanField } from '@/lib/agents/research/untrusted';

export const AFFILIATION_CLAIM_TYPE = 'identity.affiliation';
const MAX_AFFILIATION = 300;
const EMAIL = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g;
const PUBMED = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/$/;
const CLAIM = /^(.+?)'s listed affiliation on PMID (\d+): (.+)$/;

export const pubmedRecordUrl = (pmid: string): string => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

export function isAffiliationClaimType(claimType: string): boolean {
  return claimType.trim().toLowerCase() === AFFILIATION_CLAIM_TYPE;
}

/** Sanitized affiliation text with e-mail addresses removed; null when nothing usable is left. */
export function sanitizeAffiliation(raw: string | undefined): string | null {
  const cleaned = cleanField(raw, 900);
  if (!cleaned || /\[removed/i.test(cleaned)) return null;
  const text = cleaned
    .replace(/\bElectronic address:.*$/i, '')
    .replace(EMAIL, ',')
    .replace(/\s*,(?:\s*,)+/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,(?=\S)/g, ', ')
    .replace(/[\s.,;:]+$/g, '')
    .replace(/^[\s.,;:]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX_AFFILIATION ? text.slice(0, MAX_AFFILIATION).replace(/[\s,;]+\S*$/, '') : text;
}

export function affiliationEvidence(input: { name: string; pmid: string; affiliation: string | undefined; fetchedAt: string }): (Evidence & { id: string }) | null {
  const name = cleanField(input.name, 120)?.trim();
  const text = sanitizeAffiliation(input.affiliation);
  if (!name || !text || !/^\d+$/.test(input.pmid)) return null;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    id: `aff:${slug}:${input.pmid}`,
    claimType: AFFILIATION_CLAIM_TYPE,
    claim: `${name}'s listed affiliation on PMID ${input.pmid}: ${text}`,
    sourceUrl: pubmedRecordUrl(input.pmid),
    sourceKind: 'pubmed',
    fetchedAt: input.fetchedAt,
  };
}

/** Strict read-back: reserved claim type, PubMed source, and the claim's PMID must be the source record's PMID. */
export function parseAffiliationEvidence(e: { claimType: string; claim: string; sourceUrl: string; sourceKind?: string }): { pmid: string; affiliation: string } | null {
  if (!isAffiliationClaimType(e.claimType) || e.sourceKind !== 'pubmed') return null;
  const urlPmid = PUBMED.exec(e.sourceUrl)?.[1];
  const m = CLAIM.exec(e.claim);
  if (!urlPmid || !m || m[2] !== urlPmid) return null;
  return { pmid: urlPmid, affiliation: m[3]! };
}
