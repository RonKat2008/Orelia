/**
 * Claim grounding (HARD RULE 2). A model may phrase an evidence claim, but every fact in it must be derivable from
 * the tool record that carried the cited URL. Checks are deterministic and fail closed:
 *  - contact-shaped tokens (emails, phone numbers) and identifiers (URLs, NCT ids, long digit runs such as NPIs and
 *    PMIDs) must appear verbatim in that record;
 *  - every other number must appear in that record;
 *  - most content words must appear in that record, so a claim cannot assert things the record never said.
 */

const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_TOKEN = /https?:\/\/[^\s<>"')]+/gi;
const NCT = /\bnct\d{8}\b/gi;
/** Anything phone-like: 7+ digits with optional separators / country code. */
const PHONE = /(?:\+?\d[\s().-]*){7,}/g;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const WORD = /[a-z][a-z'-]{3,}/g;

/**
 * Words that describe the act of citing ("lists", "registry", "returned") rather than a fact about the resource.
 * They are allowed even when the record text does not contain them.
 */
const CITATION_WORDS = new Set(
  (
    "about also among and appears appear author authors based both called cited claims confirmed contains could " +
    "describes described describing details does each entry exact exactly from found have identity includes including " +
    "into it's list listed listing lists match matches matching more most name named names offers only other page pages " +
    "paper papers program programs provide provides providing record records registered registry report reports results " +
    "retrieved returned says shows site sites state stated states that their them there these they this those through " +
    "under unique upon were what when where which while with within years last year from".replace(/\s+/g, " ")
  ).split(" "),
);

/** Fraction of content words in a claim that the record must contain. */
export const MIN_WORD_COVERAGE = 0.6;

export type GroundingResult = { ok: true } | { ok: false; reason: string };

const digits = (s: string): string => s.replace(/\D/g, "");

function stem(word: string): string {
  return word.replace(/'s$/, "").replace(/(?:ies|es|s|ed|ing)$/, "");
}

/** Check a model-written claim against the lowercased text of the tool record(s) behind its sourceUrl. */
export function checkClaimGrounding(claim: string, recordText: string): GroundingResult {
  const text = recordText.toLowerCase();
  const textDigits = digits(text);
  let rest = claim.toLowerCase();

  for (const email of rest.match(EMAIL) ?? []) {
    if (!text.includes(email)) return { ok: false, reason: `email ${email} is not in the source record` };
  }
  rest = rest.replace(EMAIL, " ");
  for (const url of rest.match(URL_TOKEN) ?? []) {
    const bare = url.replace(/[.,;:]+$/, "");
    if (!text.includes(bare)) return { ok: false, reason: `url ${bare} is not in the source record` };
  }
  rest = rest.replace(URL_TOKEN, " ");
  for (const nct of rest.match(NCT) ?? []) {
    if (!text.includes(nct)) return { ok: false, reason: `${nct.toUpperCase()} is not in the source record` };
  }
  for (const phone of rest.match(PHONE) ?? []) {
    const d = digits(phone);
    const local = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
    if (!textDigits.includes(local)) return { ok: false, reason: `number ${phone.trim()} is not in the source record` };
  }
  rest = rest.replace(PHONE, " ");
  const recordNumbers = new Set(text.match(NUMBER) ?? []);
  for (const n of rest.match(NUMBER) ?? []) {
    if (!recordNumbers.has(n) && !text.includes(n)) return { ok: false, reason: `number ${n} is not in the source record` };
  }

  const words = (rest.match(WORD) ?? []).filter((w) => !CITATION_WORDS.has(w));
  if (words.length === 0) return { ok: true };
  const covered = words.filter((w) => text.includes(w) || text.includes(stem(w))).length;
  if (covered / words.length < MIN_WORD_COVERAGE) {
    return { ok: false, reason: `claim is not derivable from the source record (${covered}/${words.length} terms found)` };
  }
  return { ok: true };
}
