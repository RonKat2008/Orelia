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
 * True only when every distinctive token of the institution name appears in the page title or host.
 * An institution with no distinctive token (e.g. "University Hospital") never matches.
 */
export function pageMatchesInstitution(institution: string, page: { url: string; title?: string }): boolean {
  const tokens = institutionTokens(institution);
  const host = hostOf(page.url);
  if (tokens.length === 0 || !host) return false;
  const hay = `${(page.title ?? '').toLowerCase()} ${host.replace(/[.-]/g, '')}`.normalize('NFKD');
  return tokens.every((t) => hay.includes(t));
}
