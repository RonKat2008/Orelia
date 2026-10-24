/** US phone as listed by NPPES / CT.gov / a page ("617-632-3000", "(617) 632 3000") to E.164; null if not a 10-digit US number. */
export function usPhoneToE164(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(\s*[2-9]\d{2}\s*\)|\b[2-9]\d{2})[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g;
/** Words right before / after a number that mean it is not a practice intake line. */
const NOT_INTAKE_BEFORE = /\b(?:fax|facsimile|cell|cellular|mobile|pager|beeper|text(?:ing)?|sms|personal|home|direct line)\b|\bDr\.?\s+[A-Z]/i;
const NOT_INTAKE_AFTER = /^\s*[(\[-]?\s*(?:fax|cell|mobile|pager)\b/i;
/** The number must sit right after new-patient / appointment / referral / intake wording. */
const INTAKE_CONTEXT = /\b(?:new[- ]patients?|appointments?|referrals?|refer a patient|schedul\w*|intake)\b/i;
const CONTEXT_BEFORE = 120;
const GUARD_BEFORE = 30;

/**
 * Practice / intake phone lines in one block of fetched page text: only numbers within a short window after
 * new-patient, appointment, referral or intake wording, and never fax, cell, mobile, pager or a named person's line.
 */
export function intakePhonesIn(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(PHONE_RE)) {
    const at = m.index ?? 0;
    const before = block.slice(Math.max(0, at - GUARD_BEFORE), at);
    const after = block.slice(at + m[0].length, at + m[0].length + 16);
    if (NOT_INTAKE_BEFORE.test(before) || NOT_INTAKE_AFTER.test(after)) continue;
    if (!INTAKE_CONTEXT.test(block.slice(Math.max(0, at - CONTEXT_BEFORE), at))) continue;
    const e164 = usPhoneToE164(m[0]);
    if (e164 && !out.includes(e164)) out.push(e164);
  }
  return out;
}
