import type { ConditionCard, ConditionFact } from "@/lib/rare-disease/condition-facts";

/** Facts shown after the condition name, in this order. */
const EXTRA_ORDER: readonly ConditionFact["kind"][] = ["prevalence", "nearest", "experts", "centers"];
export const MAX_EXTRA_FACTS = 2;
export const MAX_QUOTES = 2;

/** The sentence a patient reads for a fact: the plain version when there is one, else the source's own value. */
export function factText(fact: ConditionFact): string {
  return fact.plain ?? fact.value;
}

export interface CompactFacts {
  name: ConditionFact | null;
  extras: ConditionFact[];
}

/**
 * The name fact plus up to two more facts for the compact card. Facts that only have a raw value (no plain
 * sentence) are skipped, except the name. Never mutates the card.
 */
export function pickCompactFacts(card: ConditionCard): CompactFacts {
  const name = card.facts.find((f) => f.kind === "name") ?? null;
  const extras = EXTRA_ORDER.flatMap((kind) => card.facts.filter((f) => f.kind === kind && f.plain)).slice(0, MAX_EXTRA_FACTS);
  return { name, extras };
}

/** Links that start with "/" stay in the app; anything else opens in a new tab. */
export const isInAppHref = (href: string): boolean => href.startsWith("/");
