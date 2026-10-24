/**
 * Adult-scope filter (pure). Wayfinder serves adults, so a children's institution or pediatric-only
 * program is out of scope. Mixed programs ("adult and pediatric", "adults and children") keep their rank,
 * and a children's-named program is kept when its own evidence says it serves adults.
 */
export interface AdultScopeInput {
  name: string;
  /** Expert specialty or similar program label. */
  specialty?: string;
  /** Evidence claim text for this record; used only to confirm adult scope, never to exclude. */
  texts?: readonly string[];
}

export interface AdultScopeVerdict {
  keep: boolean;
  reason?: string;
}

const CHILDREN_WORDS = /\b(children['’`]?s?|childrens|pediatrics?|paediatrics?|pediatric|paediatric)\b/i;
const ADULT_WORDS = /\b(adults?|all ages|lifespan|transition(?:al)? care)\b/i;

export function assessAdultScope(input: AdultScopeInput): AdultScopeVerdict {
  const label = [input.name, input.specialty].filter(Boolean).join(" ");
  if (!CHILDREN_WORDS.test(label)) return { keep: true };
  if (ADULT_WORDS.test(label)) return { keep: true };
  if ((input.texts ?? []).some((t) => ADULT_WORDS.test(t))) return { keep: true };
  return {
    keep: false,
    reason: `out of scope: children's/pediatric program ("${input.name}") with no adult care stated; Wayfinder serves adults`,
  };
}
