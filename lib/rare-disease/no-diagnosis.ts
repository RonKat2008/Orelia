/**
 * No-diagnosis guard for the undiagnosed path. Wayfinder never suggests, guesses or names a diagnosis for a patient
 * who does not have one. This deterministic check flags text that reads as a diagnostic suggestion ("could be",
 * "consistent with", "rule out ..."), or that names a specific condition. Used on top of flagMedicalAdvice, never
 * instead of it. It is a review aid with a bias toward dropping text, not a classifier.
 */

/** Phrases that suggest or weigh a diagnosis. */
const SUGGESTION_PATTERNS: readonly RegExp[] = [
  /\byou\s+(?:may|might|could|probably|likely|possibly|most likely)\s+have\b/i,
  /\b(?:may|might|could|can)\s+(?:be|indicate|mean|point to|suggest)\s+(?:a|an|the)?\s*[a-z-]+\s+(?:syndrome|disease|disorder|condition)\b/i,
  /\b(?:consistent|compatible)\s+with\b/i,
  /\b(?:suggestive|indicative|characteristic|typical)\s+of\b/i,
  /\bpoints?\s+(?:to|toward|towards)\b/i,
  /\brule[sd]?\s+out\b/i,
  /\bdifferential(?:\s+diagnosis)?\b/i,
  /\b(?:possible|probable|likely|suspected|presumed|working)\s+diagnosis\b/i,
  /\bdiagnos(?:is|ed)\s+(?:of|with|as)\s+(?!no\b|none\b)/i,
  /\b(?:sounds|looks|seems)\s+like\b/i,
];

/** A named condition: "<Word> syndrome|disease|disorder", or a clinical suffix word such as "...itis" / "...osis". */
const NAMED_CONDITION = /\b(?:[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)*\s+(?:syndrome|disease|disorder|dystrophy|anemia|anaemia)|[a-z]{4,}(?:itis|osis|emia|aemia|opathy|oma|plasia|trophy))\b/;

/** Generic phrases that mention "disease" or "disorder" but name no condition. */
const GENERIC_ALLOWED = /\b(?:undiagnosed|rare|genetic|unknown|inherited)\s+(?:diseases?|disorders?|conditions?)\b|\bUndiagnosed Diseases Network\b|\bRare Diseases? Clinical Research Network\b|\bNational Organization for Rare Disorders\b|\bRare Disease Centers? of Excellence\b|\bSyndromes Without A Name\b/gi;

/** Clinical-suffix words that are ordinary English or service words, not condition names. */
const SUFFIX_ALLOWED = new Set(["diagnosis", "prognosis", "osmosis", "aroma", "diploma", "coma", "stoma", "trophy", "atrophy"]);

export interface DiagnosisFlag {
  flagged: boolean;
  matches: string[];
}

export function flagDiagnosisGuess(text: string): DiagnosisFlag {
  const matches: string[] = [];
  for (const pattern of SUGGESTION_PATTERNS) {
    const m = pattern.exec(text);
    if (m) matches.push(m[0].trim());
  }
  const withoutGeneric = text.replace(GENERIC_ALLOWED, " ");
  const named = new RegExp(NAMED_CONDITION.source, "g");
  for (const m of withoutGeneric.matchAll(named)) {
    const word = m[0].trim();
    if (!SUFFIX_ALLOWED.has(word.toLowerCase())) matches.push(word);
  }
  const unique = [...new Set(matches)];
  return { flagged: unique.length > 0, matches: unique };
}
