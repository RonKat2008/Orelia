/**
 * Lookalike-character folding for deterministic screens (prompt-injection, no-medical-advice).
 * The original text is never changed; callers match against the folded copy and keep showing the original.
 *
 * Small vetted table: lowercase and uppercase Cyrillic and Greek letters that render like Latin letters
 * (a subset of Unicode UTS #39 confusables.txt), plus a few Latin extras. NFKC already folds fullwidth,
 * ligature and mathematical-alphabet forms.
 */
const CONFUSABLE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Cyrillic lowercase
  ['а', 'a'], ['в', 'b'], ['с', 'c'], ['ԁ', 'd'], ['е', 'e'], ['ё', 'e'], ['к', 'k'], ['м', 'm'], ['н', 'h'], ['о', 'o'],
  ['р', 'p'], ['т', 't'], ['у', 'y'], ['х', 'x'], ['і', 'i'], ['ї', 'i'], ['ј', 'j'], ['ѕ', 's'], ['һ', 'h'], ['ӏ', 'l'],
  ['ɡ', 'g'], ['ԛ', 'q'], ['ԝ', 'w'], ['ѵ', 'v'],
  // Cyrillic uppercase
  ['А', 'a'], ['В', 'b'], ['С', 'c'], ['Е', 'e'], ['Ё', 'e'], ['К', 'k'], ['М', 'm'], ['Н', 'h'], ['О', 'o'], ['Р', 'p'],
  ['Т', 't'], ['У', 'y'], ['Х', 'x'], ['І', 'i'], ['Ј', 'j'], ['Ѕ', 's'], ['Ӏ', 'l'],
  // Greek lowercase
  ['α', 'a'], ['β', 'b'], ['γ', 'y'], ['ε', 'e'], ['ι', 'i'], ['κ', 'k'], ['ν', 'v'], ['ο', 'o'], ['ρ', 'p'], ['τ', 't'],
  ['υ', 'u'], ['χ', 'x'], ['ω', 'w'],
  // Greek uppercase
  ['Α', 'a'], ['Β', 'b'], ['Ε', 'e'], ['Ζ', 'z'], ['Η', 'h'], ['Ι', 'i'], ['Κ', 'k'], ['Μ', 'm'], ['Ν', 'n'], ['Ο', 'o'],
  ['Ρ', 'p'], ['Τ', 't'], ['Υ', 'y'], ['Χ', 'x'],
  // Latin look-alikes
  ['ı', 'i'], ['ſ', 's'], ['ȷ', 'j'],
];
const CONFUSABLES: ReadonlyMap<string, string> = new Map(CONFUSABLE_PAIRS);

/** Zero-width, bidi, joiner, word-joiner, soft hyphen, BOM and Mongolian vowel separator. */
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­͏᠎]/g;
const COMBINING_MARKS = /\p{M}/gu;

/** Remove characters that render as nothing. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/**
 * Length-preserving fold: maps each lookalike letter to its Latin twin. Does not strip anything, so match
 * offsets in the result are valid offsets in the input.
 */
export function mapConfusables(text: string): string {
  let out = '';
  for (const ch of text) out += CONFUSABLES.get(ch) ?? ch;
  return out;
}

/**
 * Matching skeleton: NFKC, invisible characters and combining marks removed, lookalikes mapped to Latin,
 * lowercased. Use only for matching; show the caller's original text.
 */
export function skeleton(text: string): string {
  const base = stripInvisible(text.normalize('NFKC'));
  const bare = base.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC');
  return mapConfusables(bare).toLowerCase();
}
