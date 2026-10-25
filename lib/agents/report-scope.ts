/**
 * Scope check for a pasted report (pure). Orelia serves adults in the United States. This only catches the
 * unambiguous pediatric cases up front: every stated age is under 18, or the text says infant / newborn /
 * "pediatric patient". Anything murkier is left to the extractor's own out-of-scope flag.
 */
export type OutOfScope = "pediatric" | "non_us";

const AGE_YEARS = /\b(\d{1,3})[\s-]*(?:years?|yrs?|y\/o|yo)[\s-]*(?:old)?\b/gi;
const AGE_LABEL = /\bage[d]?\s*[:=]?\s*(\d{1,3})\b/gi;
const AGE_YOUNG_UNITS = /\b\d{1,2}[\s-]*(?:months?|weeks?|days?)[\s-]*old\b/i;
const PEDIATRIC_WORDS = /\b(?:infant|newborn|neonate|toddler|pediatric patient|paediatric patient)\b/i;

function statedAges(text: string): number[] {
  const ages: number[] = [];
  for (const re of [AGE_YEARS, AGE_LABEL]) {
    for (const match of text.matchAll(re)) ages.push(Number(match[1]));
  }
  return ages;
}

export function assessReportScope(text: string): OutOfScope | null {
  if (PEDIATRIC_WORDS.test(text) || AGE_YOUNG_UNITS.test(text)) return "pediatric";
  const ages = statedAges(text);
  return ages.length > 0 && ages.every((age) => age < 18) ? "pediatric" : null;
}

export class OutOfScopeError extends Error {
  constructor(public readonly reason: OutOfScope) {
    super(OUT_OF_SCOPE_MESSAGE[reason]);
    this.name = "OutOfScopeError";
  }
}

export const OUT_OF_SCOPE_MESSAGE: Record<OutOfScope, string> = {
  pediatric:
    "Orelia is built for adult patients, so it cannot search for a child's case. A children's hospital or your child's care team is the right place to ask for referrals.",
  non_us:
    "Orelia currently covers specialists, trials and aid in the United States only, so it cannot search for a patient who lives elsewhere.",
};
