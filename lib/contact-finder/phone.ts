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
/** The number must sit right after (or just before) new-patient / appointment / referral / intake wording. */
const INTAKE_CONTEXT = /\b(?:new[- ]patients?|appointments?|referrals?|referring|refer a patient|schedul\w*|intake)\b/i;
const INTAKE_CONTEXT_ALL = new RegExp(INTAKE_CONTEXT.source, 'gi');
const CONTEXT_BEFORE = 160;
const CONTEXT_AFTER = 60;
const GUARD_BEFORE = 30;

export type IntakePhoneKind = 'new_patient_line' | 'referral_coordinator';
export interface IntakePhone { phone: string; kind: IntakePhoneKind; excerpt: string }

const lastMatch = (text: string): string | null => {
  const all = [...text.matchAll(INTAKE_CONTEXT_ALL)];
  return all.length ? all[all.length - 1]![0] : null;
};

/**
 * Practice / intake phone lines in fetched page text, block by block (a block's context includes the block before
 * it, so "To make an appointment:" followed by a number on the next line counts). Never fax, cell, mobile, pager or
 * a named person's line. `excerpt` is the intake wording found (a substring of the page text).
 */
export function intakePhonesInBlocks(blocks: readonly string[]): IntakePhone[] {
  const out: IntakePhone[] = [];
  blocks.forEach((block, i) => {
    const prev = i > 0 ? blocks[i - 1]! : '';
    for (const m of block.matchAll(PHONE_RE)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      if (NOT_INTAKE_BEFORE.test(block.slice(Math.max(0, at - GUARD_BEFORE), at)) || NOT_INTAKE_AFTER.test(block.slice(end, end + 16))) continue;
      const before = `${prev}\n${block.slice(0, at)}`.slice(-CONTEXT_BEFORE);
      const after = block.slice(end, end + CONTEXT_AFTER);
      const excerpt = lastMatch(before) ?? (INTAKE_CONTEXT.exec(after)?.[0] ?? null);
      const e164 = excerpt ? usPhoneToE164(m[0]) : null;
      if (!e164 || out.some((o) => o.phone === e164)) continue;
      out.push({ phone: e164, kind: /refer/i.test(excerpt!) ? 'referral_coordinator' : 'new_patient_line', excerpt: excerpt! });
    }
  });
  return out;
}

/** Intake phone numbers in one block of text (see intakePhonesInBlocks). */
export function intakePhonesIn(block: string): string[] {
  return intakePhonesInBlocks([block]).map((p) => p.phone);
}
