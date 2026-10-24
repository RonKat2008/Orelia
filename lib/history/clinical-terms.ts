/**
 * Vocabulary used to compare what different records say. This only NORMALISES wording so that "vEDS" and
 * "vascular Ehlers-Danlos syndrome" are recognised as the same name; it never judges which record is right.
 */

export type VariantClass = 'pathogenic' | 'likely_pathogenic' | 'vus' | 'likely_benign' | 'benign';

export const VARIANT_CLASS_LABELS: Record<VariantClass, string> = {
  pathogenic: 'Pathogenic', likely_pathogenic: 'Likely pathogenic', vus: 'Variant of uncertain significance',
  likely_benign: 'Likely benign', benign: 'Benign',
};

/** Reads an ACMG-style class out of free text. "likely pathogenic" is checked before "pathogenic". */
export function classifyVariantTerm(text: string): VariantClass | null {
  const t = text.toLowerCase().replace(/[-_]/g, ' ');
  if (/\b(?:likely|probably) pathogenic\b/.test(t)) return 'likely_pathogenic';
  if (/\buncertain significance\b|\bvus\b/.test(t)) return 'vus';
  if (/\b(?:likely|probably) benign\b/.test(t)) return 'likely_benign';
  if (/\b(?<!non |not |un)pathogenic\b/.test(t)) return 'pathogenic';
  if (/\bbenign\b/.test(t)) return 'benign';
  return null;
}

interface DiagnosisSynonym { key: string; label: string; patterns: RegExp[] }

// Patterns run against lowercase text with punctuation turned into single spaces.
const DIAGNOSIS_SYNONYMS: DiagnosisSynonym[] = [
  {
    key: 'vascular-eds', label: 'Vascular Ehlers-Danlos syndrome',
    patterns: [/\bveds\b/, /\bvascular (?:type )?(?:ehlers danlos|eds)\b/, /\b(?:ehlers danlos|eds)(?: syndrome)?,? (?:type )?(?:iv|4|vascular)\b/],
  },
  {
    key: 'hypermobile-eds', label: 'Hypermobile Ehlers-Danlos syndrome',
    patterns: [/\bheds\b/, /\bhypermobile (?:type )?(?:ehlers danlos|eds)\b/, /\b(?:ehlers danlos|eds)(?: syndrome)?,? (?:type )?(?:iii|3|hypermobile|hypermobility)\b/],
  },
  { key: 'ehlers-danlos-unspecified', label: 'Ehlers-Danlos syndrome', patterns: [/\behlers danlos\b/] },
  { key: 'epithelioid-sarcoma', label: 'Epithelioid sarcoma', patterns: [/\bepithelioid sarcoma\b/] },
  { key: 'granuloma-annulare', label: 'Granuloma annulare', patterns: [/\bgranuloma annulare\b/] },
  {
    key: 'igg4-related-disease', label: 'IgG4-related disease',
    patterns: [/\bigg4 (?:rd|related)\b/, /\bimmunoglobulin g4 (?:rd|related)\b/],
  },
  {
    key: 'pancreatic-adenocarcinoma', label: 'Pancreatic adenocarcinoma',
    patterns: [/\bpancreatic (?:ductal )?adenocarcinoma\b/, /\bpancreatic cancer\b/, /\bpdac\b/],
  },
];

const HEDGES = [
  'suspected', 'suspect', 'possible', 'probable', 'probably', 'presumed', 'likely', 'consistent with', 'suggestive of',
  'concerning for', 'rule out', 'query', 'history of', 'genetically confirmed', 'confirmed', 'definite', 'final',
  'working', 'clinical', 'new', 'diagnosis of', 'diagnosed with',
];
const HEDGE_RE = new RegExp(`\\b(?:${HEDGES.map(h => h.replace(/ /g, '\\s+')).join('|')})\\b`, 'g');

function plain(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface NormalizedDiagnosis { key: string; label: string }

/** Canonical key + display label for a diagnosis as written in a record. */
export function normalizeDiagnosis(raw: string): NormalizedDiagnosis {
  const full = plain(raw);
  for (const synonym of DIAGNOSIS_SYNONYMS) {
    if (synonym.patterns.some(p => p.test(full))) return { key: synonym.key, label: synonym.label };
  }
  const withoutParens = raw.replace(/\([^)]*\)/g, ' ');
  let cleaned = plain(withoutParens.split(/[;,]| with | consistent /i)[0] ?? withoutParens).replace(HEDGE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = full || raw.trim().toLowerCase();
  const label = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return { key: cleaned, label };
}

/** IHC / marker names whose status records sometimes disagree about. */
export interface MarkerSpec { key: string; label: string; pattern: RegExp; statuses: [string, RegExp][] }

const RETAINED_LOST: [string, RegExp][] = [
  ['lost', /\b(?:lost|loss|absent|absence|deficien\w*|negative|not expressed|no expression)\b/i],
  ['retained', /\b(?:retained|intact|preserved|present|positive|expressed)\b/i],
];
const POS_NEG: [string, RegExp][] = [
  ['negative', /\b(?:negative|non-?reactive|not expressed|absent)\b/i],
  ['positive', /\b(?:positive|reactive|expressed|diffuse|strong)\b/i],
];

export const MARKERS: MarkerSpec[] = [
  { key: 'ini1-smarcb1', label: 'INI1 (SMARCB1) expression', pattern: /\b(?:INI-?1|SMARCB1|BAF47)\b/i, statuses: RETAINED_LOST },
  { key: 'cd34', label: 'CD34', pattern: /\bCD34\b/i, statuses: POS_NEG },
  { key: 'erg', label: 'ERG', pattern: /\bERG\b/, statuses: POS_NEG },
  { key: 'ema', label: 'EMA', pattern: /\bEMA\b/, statuses: POS_NEG },
  { key: 'keratin', label: 'Cytokeratin', pattern: /\b(?:cytokeratin|AE1\/AE3)\b/i, statuses: POS_NEG },
];
