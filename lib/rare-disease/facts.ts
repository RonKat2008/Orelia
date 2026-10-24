import { z } from "zod";
import raw from "../../data/rare-disease-facts.json";

/** One sourced fact. `excerpt` is the exact sentence fetched from `url` by scripts/fetch-rare-facts.ts. */
export const RareFactSchema = z.object({
  id: z.string().min(1),
  /** Plain-words line shown above the quote. Every number in it must appear in `excerpt`. */
  claim: z.string().min(1),
  url: z.string().url().refine((u) => u.startsWith("https://"), "source must be https"),
  title: z.string().min(1),
  fetchedAt: z.string().datetime(),
  excerpt: z.string().min(20),
});

export const RareFactsFileSchema = z.object({ facts: z.array(RareFactSchema) });

export type RareFact = z.infer<typeof RareFactSchema>;

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|hundred|thousand|million";
const NUMBER_RE = new RegExp(`\\d[\\d,.]*|\\b(?:${NUMBER_WORDS})\\b`, "gi");

/** Every number (digits or number word) in a text, lower-cased, trailing punctuation trimmed. */
export function numbersIn(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map((n) => n.toLowerCase().replace(/[.,]+$/, ""));
}

/** True when every number in `claim` literally appears in `excerpt`. */
export function claimNumbersAreSourced(claim: string, excerpt: string): boolean {
  const sourced = new Set(numbersIn(excerpt));
  return numbersIn(claim).every((n) => sourced.has(n));
}

/** Facts safe to render: valid, https-sourced, and every number backed by the excerpt. */
export function loadRareFacts(input: unknown = raw): readonly RareFact[] {
  const parsed = RareFactsFileSchema.parse(input);
  return parsed.facts.filter((f) => claimNumbersAreSourced(f.claim, f.excerpt));
}
