import { cleanField } from '@/lib/agents/research/untrusted';

const INSTITUTION_WORD = /\b(university|universit[äay]t?|hospital|medical cent(?:er|re)|clinic|institute|cancer cent(?:er|re)|health system|school of medicine|college of medicine|infirmary|foundation trust)\b/i;
const SUB_UNIT = /^(?:the\s+)?(?:department|dept|division|section|program|laboratory|lab|unit|center for|centre for|institute for|institute of (?:pathology|biochemistry))\b/i;
const MAX_NAME = 120;

/**
 * Deterministic institution name from a PubMed affiliation string: the first comma segment that names an
 * institution (University / Hospital / Medical Center / Clinic / Institute / Cancer Center ...) and is not a
 * sub-unit such as "Department of Medicine". The text is sanitized first; nothing else is read from it.
 */
export function extractInstitution(raw: string | undefined): string | null {
  const cleaned = cleanField(raw, 600);
  if (!cleaned) return null;
  const first = cleaned.split(/;\s+/)[0] ?? '';
  const text = first.replace(/\bElectronic address:.*$/i, '').replace(/^\s*(?:from the|\(?\d+\)?)\s+/i, '');
  for (const part of text.split(',')) {
    const seg = part.replace(/^\s*(?:and|&)\s+/i, '').replace(/[.\s]+$/, '').trim();
    if (!seg || SUB_UNIT.test(seg) || !INSTITUTION_WORD.test(seg) || /\[removed:/.test(seg)) continue;
    if (/@/.test(seg)) continue;
    return seg.slice(0, MAX_NAME);
  }
  return null;
}

const GENERIC = new Set(['the', 'of', 'and', 'for', 'at', 'in', 'university', 'hospital', 'medical', 'center', 'centre', 'health', 'institute', 'clinic', 'school', 'college', 'cancer', 'system', 'medicine', 'foundation', 'trust']);

/** Distinctive lower-case tokens of an institution name (generic words removed). */
export function institutionTokens(name: string): string[] {
  return [...new Set(name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((t) => t.length >= 3 && !GENERIC.has(t)))];
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
}

const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
};

/**
 * Institutions whose web domain does not spell out their name. Keyed by distinctive tokens (all must be present in
 * the institution name); the page host must equal the domain or be a subdomain of it.
 */
const KNOWN_DOMAINS: ReadonlyArray<{ tokens: readonly string[]; domains: readonly string[] }> = [
  { tokens: ['johns', 'hopkins'], domains: ['hopkinsmedicine.org', 'jhu.edu', 'jhmi.edu'] },
  { tokens: ['massachusetts', 'general'], domains: ['massgeneral.org', 'mgh.harvard.edu'] },
  { tokens: ['memorial', 'sloan', 'kettering'], domains: ['mskcc.org'] },
  { tokens: ['brigham', 'women'], domains: ['massgeneralbrigham.org'] },
];

const onDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/**
 * True only when the page HOST belongs to the institution: every distinctive token of the name appears in the host,
 * the registrable domain is the name's initials, or the host is a known domain of that institution. The title is never enough on its own (anyone can title a page
 * "<Institution> second opinion"). An institution with no distinctive token (e.g. "University Hospital") never matches.
 */
const ACRONYM_STOP = new Set(['of', 'the', 'and', 'at', 'for', 'in', 'on']);

/** Initials of the institution name ("Oregon Health & Science University" -> "ohsu"); null when shorter than 3. */
export function institutionAcronym(name: string): string | null {
  const words = name.normalize('NFKD').replace(/[^A-Za-z\s-]/g, ' ').split(/[\s-]+/).filter((w) => w && !ACRONYM_STOP.has(w.toLowerCase()));
  const acronym = words.map((w) => w[0]!.toLowerCase()).join('');
  return acronym.length >= 3 ? acronym : null;
}

export function pageMatchesInstitution(institution: string, page: { url: string; title?: string }): boolean {
  const tokens = institutionTokens(institution);
  const host = hostOf(page.url);
  if (tokens.length === 0 || !host) return false;
  const compactHost = host.normalize('NFKD').replace(/[.-]/g, '');
  if (tokens.every((t) => compactHost.includes(t))) return true;
  // The registrable domain IS the institution's initials (ohsu.edu, uab.edu, chop.edu).
  const acronym = institutionAcronym(institution);
  if (acronym && host.split('.').at(-2) === acronym) return true;
  const have = new Set(tokens);
  return KNOWN_DOMAINS.some((k) => k.tokens.every((t) => have.has(t)) && k.domains.some((d) => onDomain(host, d)));
}
