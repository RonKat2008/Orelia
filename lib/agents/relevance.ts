import type { CaseInput, TrialRegistry } from "@/lib/contracts";

/**
 * Deterministic relevance and scope filters (no model in the loop). They only read registry facts that
 * code stamped from tool output (Resource.registry), never model prose.
 *  - disease relevance: the disease or subtype (or a MeSH term present in the record) must appear in the trial's
 *    conditions, keywords, MeSH terms or title. A broad category ("Sarcoma") alone does not qualify.
 *  - adult scope: pediatric-only studies are out of scope.
 */

export type TrialMatch = "condition" | "keyword" | "title";

export interface TrialVerdict {
  keep: boolean;
  /** Why the trial was dropped (set when keep is false). */
  reason?: string;
  /** Strongest place the disease/subtype was found (set when keep is true). */
  match?: TrialMatch;
}

const ADULT_AGES = new Set(["ADULT", "OLDER_ADULT"]);
const ADULT_MIN_AGE_YEARS = 18;
const PEDIATRIC_WORDS = /\b(pediatrics?|paediatrics?|children|child|childhood|infants?|adolescents?|neonat\w*)\b/i;
const ADULT_WORD = /\badults?\b/i;

const normalize = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    // Light singularisation so "Sarcomas" matches "sarcoma".
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));

/** Terms the trial must mention: the disease name and the subtype, if any. */
export function diseaseTerms(c: Pick<CaseInput, "diseaseName" | "subtype">): string[] {
  return [c.diseaseName, c.subtype].filter((t): t is string => !!t && t.trim() !== "");
}

/** Every term token appears in the phrase (handles MeSH inversion: "Sarcoma, Epithelioid"). */
function phraseHasTerm(phrase: string, term: string): boolean {
  const have = new Set(normalize(phrase));
  const want = normalize(term);
  return want.length > 0 && want.every((t) => have.has(t));
}

/** The term appears as a contiguous run of words inside free text such as a title. */
function textHasTerm(text: string, term: string): boolean {
  const have = normalize(text);
  const want = normalize(term);
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((w, j) => have[i + j] === w)) return true;
  }
  return false;
}

export interface DiseaseMatch {
  kind: TrialMatch;
  /** The registry phrase (or title) that matched, for human-readable signal text. */
  phrase: string;
}

export function diseaseMatch(
  registry: Pick<TrialRegistry, "conditions" | "keywords" | "meshTerms">,
  title: string,
  terms: readonly string[],
): DiseaseMatch | null {
  const find = (phrases: readonly string[]) => phrases.find((p) => terms.some((t) => phraseHasTerm(p, t)));
  const condition = find(registry.conditions) ?? find(registry.meshTerms);
  if (condition) return { kind: "condition", phrase: condition };
  const keyword = find(registry.keywords);
  if (keyword) return { kind: "keyword", phrase: keyword };
  if (terms.some((t) => textHasTerm(title, t))) return { kind: "title", phrase: title };
  return null;
}

/** Does free text mention the full disease name/subtype ("exact") or one of its distinctive words ("family")? */
export function mentionStrength(text: string, c: Pick<CaseInput, "diseaseName" | "subtype">): "exact" | "family" | "none" {
  if (diseaseTerms(c).some((t) => textHasTerm(text, t))) return "exact";
  const generic = new Set(["disease", "syndrome", "disorder", "related", "type", "vascular", "chronic", "primary"]);
  const words = new Set(normalize(text));
  const distinctive = diseaseTerms(c).flatMap(normalize).filter((w) => w.length >= 5 && !generic.has(w));
  return distinctive.some((w) => words.has(w)) ? "family" : "none";
}

/** Parses CT.gov ages such as "12 Years", "6 Months", "18 Years"; "N/A", empty or unknown units give undefined. */
export function parseAgeYears(age: string | undefined): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(year|month|week|day|hour|minute)s?\b/i.exec(age ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  const perYear: Record<string, number> = { year: 1, month: 12, week: 52, day: 365, hour: 8760, minute: 525600 };
  return n / (perYear[unit] ?? 1);
}

/**
 * Does the study enroll adults (18+)? true / false, or undefined when the registry does not say.
 *  - a maximum age under 18 excludes adults, whatever stdAges says
 *  - stdAges naming ADULT or OLDER_ADULT enrolls adults (mixed child+adult studies are kept)
 *  - stdAges that is only CHILD does not
 *  - with no stdAges, a parsable age bound decides; an unparsable one ("N/A") leaves it unknown
 */
export function enrollsAdults(registry: Pick<TrialRegistry, "stdAges" | "minimumAge"> & { maximumAge?: string }): boolean | undefined {
  const max = parseAgeYears(registry.maximumAge);
  if (max !== undefined && max < ADULT_MIN_AGE_YEARS) return false;
  if (registry.stdAges.some((a) => ADULT_AGES.has(a.toUpperCase()))) return true;
  if (registry.stdAges.length > 0) return false;
  return parseAgeYears(registry.minimumAge) !== undefined || max !== undefined ? true : undefined;
}

export function isPediatricFocused(title: string, registry: Pick<TrialRegistry, "conditions" | "keywords">): boolean {
  const text = [title, ...registry.conditions, ...registry.keywords].join(" | ");
  return PEDIATRIC_WORDS.test(text) && !ADULT_WORD.test(text);
}

/** Verdict for one trial. Trials without registry facts cannot be assessed and are left to the caller. */
export function assessTrial(
  trial: { title: string; registry: TrialRegistry },
  c: Pick<CaseInput, "diseaseName" | "subtype">,
): TrialVerdict {
  const { registry } = trial;
  const found = diseaseMatch(registry, trial.title, diseaseTerms(c));
  if (!found) {
    return {
      keep: false,
      reason: `off-target: ${diseaseTerms(c).map((t) => `"${t}"`).join(" / ")} not in conditions, keywords, MeSH terms or title`,
    };
  }
  const adults = enrollsAdults(registry);
  if (adults === undefined) return { keep: false, reason: "out of scope: age eligibility not stated" };
  if (!adults) return { keep: false, reason: "out of scope: does not enroll adults (pediatric only)" };
  if (isPediatricFocused(trial.title, registry)) {
    return { keep: false, reason: "out of scope: pediatric-focused study" };
  }
  return { keep: true, match: found.kind };
}
