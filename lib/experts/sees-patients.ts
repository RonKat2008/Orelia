import type { NppesProvider } from '@/lib/agents/research/source-ports';
import { cleanField } from '@/lib/agents/research/untrusted';

export const nppesRegistryUrl = (npi: string): string => `https://npiregistry.cms.hhs.gov/provider-view/${npi}`;

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
const NON_CLINICAL_DESC = /research|scientist|laborator|informatics|administrat/i;
const CLINICAL_DESC = /physician|oncolog|surg|medicine|hematolog|rheumat|genetic|cardio|pediatric|neurolog|gastro|dermat|orthop|nurse practitioner|physician assistant|radiation/i;

/** Physician (20x, except pathology 207Z / radiology 2085), NP and PA taxonomy codes see patients. */
function clinicalCode(code: string): boolean {
  const c = code.toUpperCase();
  if (c.startsWith('207Z') || c.startsWith('2085')) return false;
  return /^20[0-9]/.test(c) || c.startsWith('363A') || c.startsWith('363L');
}

export interface TaxonomyFact { code?: string; desc?: string }

function taxonomyFacts(p: NppesProvider): TaxonomyFact[] {
  const raw = p.raw?.taxonomies?.map((t) => ({ code: t.code, desc: t.desc })) ?? [];
  return raw.length ? raw : p.taxonomy ? [{ desc: p.taxonomy }] : [];
}

/** Conservative: a patient-care taxonomy and no research-only wording. Missing taxonomy is NOT clinical. */
export function clinicalTaxonomy(p: NppesProvider): string | null {
  for (const t of taxonomyFacts(p)) {
    if (t.desc && NON_CLINICAL_DESC.test(t.desc)) continue;
    if (t.code ? clinicalCode(t.code) : false) return cleanField(t.desc, 80) ?? t.code ?? 'clinical taxonomy';
    if (!t.code && t.desc && CLINICAL_DESC.test(t.desc) && !/patholog|radiolog/i.test(t.desc)) return cleanField(t.desc, 80) ?? t.desc;
  }
  return null;
}

export type NppesAssessment =
  | { kind: 'yes'; provider: NppesProvider; taxonomy: string }
  | { kind: 'unknown'; reason: 'no_match' | 'multiple' | 'non_clinical' | 'location_mismatch' | 'lookup_failed' };

/** Where the paper affiliation places the author: two-letter US state and/or city. */
export interface LocationAnchor { state?: string; city?: string }

const locNorm = (s: string | undefined): string => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');

/**
 * The registry entry is the paper author only when its practice location matches the affiliation: the state when the
 * affiliation names one, otherwise the city. No anchor (or no registry location) never confirms identity.
 */
function locationMatches(p: NppesProvider, anchor: LocationAnchor): boolean {
  const addresses = p.raw?.addresses ?? [];
  if (anchor.state) {
    const want = anchor.state.trim().toUpperCase();
    return [p.state, ...addresses.map((a) => a.state)].some((s) => !!s && s.trim().toUpperCase() === want);
  }
  const city = locNorm(anchor.city);
  return !!city && [p.city, ...addresses.map((a) => a.city)].some((c) => locNorm(c) === city);
}

/**
 * 'yes' only for exactly one exact-name individual (NPI-1) match with a clinical taxonomy whose practice location
 * matches the paper affiliation. Absence is never 'no'.
 */
export function assessNppes(providers: readonly NppesProvider[], first: string, last: string, anchor: LocationAnchor): NppesAssessment {
  const exact = providers.filter((p) => norm(p.firstName) === norm(first) && norm(p.lastName) === norm(last)
    && /^\d{10}$/.test(p.npi) && p.raw?.enumeration_type !== 'NPI-2');
  if (exact.length === 0) return { kind: 'unknown', reason: 'no_match' };
  if (exact.length > 1) return { kind: 'unknown', reason: 'multiple' };
  const provider = exact[0]!;
  if (!locationMatches(provider, anchor)) return { kind: 'unknown', reason: 'location_mismatch' };
  const taxonomy = clinicalTaxonomy(provider);
  return taxonomy ? { kind: 'yes', provider, taxonomy } : { kind: 'unknown', reason: 'non_clinical' };
}

const PATIENT_LANGUAGE = /\b(appointments?|new patients?|accepting patients|schedule a visit|patient care|make an appointment)\b/i;

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (body: string, word: string): boolean => {
  const w = fold(word).trim();
  return !!w && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'u').test(body);
};

/** A clinic profile page counts only when it names the author (first and last, whole words) and uses patient language. */
export function pageShowsPatientCare(text: string | undefined, title: string | undefined, first: string, last: string): boolean {
  const body = fold(`${title ?? ''} ${text ?? ''}`);
  return hasWord(body, first) && hasWord(body, last) && PATIENT_LANGUAGE.test(body);
}
