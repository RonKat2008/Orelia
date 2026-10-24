/**
 * Phone grounding (HARD RULE 2): a phone number is accepted only if it appears, as one phone-shaped token, in the
 * source text it supposedly came from. Digits are never joined across unrelated numbers, dates or ids.
 */

/** One phone-shaped token: 7+ digits with at most two separator characters between digits (no slashes or letters). */
const PHONE_TOKEN = /(?<![\d])\+?\d(?:[\s().-]{0,2}\d){6,}(?![\d])/g;
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/** Digits only, with a leading US country code removed from 11-digit numbers. */
export function normalizePhone(value: string): string {
  const d = value.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** Normalized digit strings of every phone-shaped token in `text`. */
export function phoneNumbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.normalize('NFKC').matchAll(PHONE_TOKEN)) {
    const d = normalizePhone(m[0]);
    if (d.length >= MIN_DIGITS && d.length <= MAX_DIGITS) out.push(d);
  }
  return out;
}

/** True when `phone` equals a phone-shaped token in any of the source texts. */
export function isPhoneGrounded(phone: string | undefined, ...sources: Array<string | undefined>): boolean {
  if (!phone) return false;
  const want = normalizePhone(phone);
  if (want.length < MIN_DIGITS || want.length > MAX_DIGITS) return false;
  return sources.some(text => !!text && phoneNumbersIn(text).includes(want));
}
