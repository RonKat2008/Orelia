/**
 * "This form also asks for:" the patient answers the questions a form asks that no consented case field covers
 * (name, date of birth, email, phone...). Pure functions, shared by the answers route, the demo and the tests.
 *
 *   answerableQuestions(draft)        -> which missing fields the patient may answer here (never health questions,
 *                                        files or checkboxes; those stay with the patient / care team)
 *   validateAnswers(draft, raw)       -> Zod + per-kind checks (email, real past date, phone, length caps) + sanitiser
 *   applyAnswers(draft, answers)      -> the re-mapped draft: answered fields move from `missing` to `fields` with a
 *                                        'patient' source. Uses the form fields captured at fill time; no re-browse.
 *   suggestAnswers(questions, ...)    -> pre-fill from the account profile, the synthetic demo patient, or this case's
 *                                        earlier forms. Suggestions are only shown to the patient; nothing is stored
 *                                        or sent until they tap "Save and fill".
 * An answer is consent for its own application only: it is stored on that row and the gate checks it from there.
 */
import { z } from 'zod';
import { cleanField } from '../agents/research/untrusted';
import type { FilledField, MissingField, PatientAnswer, WebApplicationDraft } from './types';

export type AnswerKind = 'email' | 'date' | 'phone' | 'first_name' | 'last_name' | 'full_name' | 'city' | 'state' | 'zip' | 'text';
export type AnswerOrigin = PatientAnswer['origin'];

export interface AnswerQuestion {
  fieldKey: string;
  label: string;
  required: boolean;
  kind: AnswerKind;
  /** Input type for the UI. */
  inputType: 'email' | 'date' | 'tel' | 'text';
}

export interface AnswerSuggestion { value: string; origin: AnswerOrigin }

export const MAX_ANSWER_CHARS = 200;
export const MAX_ANSWERS = 40;
const ORIGINS = ['typed', 'profile', 'earlier', 'demo'] as const;

/** Classifies a form question by its input type first, then its label. */
export function answerKind(label: string, type?: string): AnswerKind {
  const l = label.toLowerCase();
  if (type === 'email' || /\be-?mail\b/.test(l)) return 'email';
  if (type === 'date' || /\b(date of birth|birth ?date|dob|birthday)\b/.test(l)) return 'date';
  if (type === 'tel' || /\b(phone|mobile|cell|telephone)\b/.test(l)) return 'phone';
  if (/\b(first|given) ?name\b/.test(l)) return 'first_name';
  if (/\b(last|family|sur) ?name\b|\bsurname\b/.test(l)) return 'last_name';
  if (/\b(full |legal |your |patient )?name\b/.test(l) && !/\b(physician|doctor|provider|insur|plan|clinic|hospital|emergency)\b/.test(l)) return 'full_name';
  if (/\bzip\b|\bpostal\b/.test(l)) return 'zip';
  if (/\bcity\b|\btown\b/.test(l)) return 'city';
  if (/\bstate\b/.test(l)) return 'state';
  return 'text';
}

const INPUT_TYPE: Record<AnswerKind, AnswerQuestion['inputType']> = {
  email: 'email', date: 'date', phone: 'tel', first_name: 'text', last_name: 'text', full_name: 'text', city: 'text', state: 'text', zip: 'text', text: 'text',
};

/**
 * The patient may answer a field only when the form left it blank because no consented case field covered it.
 * Health questions ('medical_question'), files and checkboxes are never answered here.
 */
export function answerableQuestions(draft: Pick<WebApplicationDraft, 'missing'>): AnswerQuestion[] {
  return draft.missing
    .filter(m => m.reason === 'no_consented_source' && m.type !== 'file' && m.type !== 'checkbox')
    .map(m => {
      const kind = answerKind(m.label, m.type);
      return { fieldKey: m.fieldKey, label: m.label || m.fieldKey, required: m.required, kind, inputType: INPUT_TYPE[kind] };
    });
}

const isRealPastDate = (s: string, now: Date) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  return y >= 1900 && date.getTime() <= now.getTime();
};

const VALUE_RULES: Record<AnswerKind, { schema: z.ZodType<string>; message: string }> = {
  email: { schema: z.email().max(MAX_ANSWER_CHARS), message: 'Enter an email address like name@example.com' },
  date: { schema: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), message: 'Enter a real date as YYYY-MM-DD' },
  phone: { schema: z.string().regex(/^[+()\d\s.-]{7,20}$/), message: 'Use digits, spaces, + ( ) . -' },
  zip: { schema: z.string().regex(/^\d{5}(-\d{4})?$/), message: 'Use a 5-digit ZIP' },
  first_name: { schema: z.string().max(80), message: 'Keep it under 80 characters' },
  last_name: { schema: z.string().max(80), message: 'Keep it under 80 characters' },
  full_name: { schema: z.string().max(160), message: 'Keep it under 160 characters' },
  city: { schema: z.string().max(80), message: 'Keep it under 80 characters' },
  state: { schema: z.string().max(40), message: 'Keep it under 40 characters' },
  text: { schema: z.string().max(MAX_ANSWER_CHARS), message: `Keep it under ${MAX_ANSWER_CHARS} characters` },
};

/** Request body: fieldKey -> { value, origin }. A bare string counts as typed. Empty values clear an answer. */
export const answersBodySchema = z.object({
  answers: z.record(
    z.string().min(1).max(200),
    z.union([
      z.string().max(MAX_ANSWER_CHARS * 2),
      z.object({ value: z.string().max(MAX_ANSWER_CHARS * 2), origin: z.enum(ORIGINS).optional() }).strict(),
    ]),
  ).refine(r => Object.keys(r).length <= MAX_ANSWERS, `At most ${MAX_ANSWERS} answers`),
}).strict();
export type AnswersBody = z.infer<typeof answersBodySchema>;

export type AnswerValidation =
  | { ok: true; answers: Record<string, PatientAnswer> }
  | { ok: false; issues: { fieldKey: string; message: string }[] };

/**
 * Checks every answer against the question it answers: unknown or non-answerable keys are refused (so a health
 * question can never be answered through this path), values are sanitised, then checked by kind.
 */
export function validateAnswers(draft: Pick<WebApplicationDraft, 'missing'>, body: AnswersBody, now: Date = new Date()): AnswerValidation {
  const questions = new Map(answerableQuestions(draft).map(q => [q.fieldKey, q]));
  const issues: { fieldKey: string; message: string }[] = [];
  const answers: Record<string, PatientAnswer> = {};
  for (const [fieldKey, raw] of Object.entries(body.answers)) {
    const q = questions.get(fieldKey);
    if (!q) { issues.push({ fieldKey, message: 'This question cannot be answered here' }); continue; }
    const rawValue = typeof raw === 'string' ? raw : raw.value;
    const origin: AnswerOrigin = typeof raw === 'string' ? 'typed' : raw.origin ?? 'typed';
    // Sanitiser: strips control characters and neutralises instruction-like markup, then trims and collapses space.
    const value = (cleanField(rawValue, MAX_ANSWER_CHARS * 2) ?? '').replace(/\s+/g, ' ').trim();
    if (!value) continue; // left blank: the question stays open
    const rule = VALUE_RULES[q.kind];
    const parsed = rule.schema.safeParse(value);
    if (!parsed.success || (q.kind === 'date' && !isRealPastDate(value, now))) { issues.push({ fieldKey, message: rule.message }); continue; }
    answers[fieldKey] = { value, origin };
  }
  return issues.length ? { ok: false, issues } : { ok: true, answers };
}

/**
 * The re-mapped draft. Fields the patient answered move from `missing` into `fields` (source 'patient'); all other
 * filled values and the remaining questions are kept exactly. Answers for keys the form does not ask are ignored.
 */
export function applyAnswers(
  draft: Pick<WebApplicationDraft, 'fields' | 'missing'>,
  answers: Readonly<Record<string, PatientAnswer>>,
): { fields: FilledField[]; missing: MissingField[] } {
  const answerable = new Set(answerableQuestions(draft).map(q => q.fieldKey));
  const fields: FilledField[] = draft.fields.map(f => ({ ...f }));
  const missing: MissingField[] = [];
  for (const m of draft.missing) {
    const answer = answerable.has(m.fieldKey) ? answers[m.fieldKey] : undefined;
    if (!answer?.value) { missing.push({ ...m }); continue; }
    fields.push({ fieldKey: m.fieldKey, label: m.label, type: m.type ?? 'text', value: answer.value, source: { kind: 'patient', origin: answer.origin } });
  }
  return { fields, missing };
}

/** fieldKey -> value of the patient's answers that the draft actually uses (what the gate checks against). */
export function usedAnswers(draft: Pick<WebApplicationDraft, 'fields' | 'answers'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of draft.fields) {
    const stored = draft.answers?.[f.fieldKey];
    if (f.source.kind === 'patient' && stored && typeof f.value === 'string' && stored.value === f.value) out[f.fieldKey] = stored.value;
  }
  return out;
}

/** Generic identity details the patient keeps in their own account (or the synthetic demo patient). */
export interface IdentityProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/** The live demo's patient. Clearly synthetic; the email is a test inbox the project owns (on OUTBOUND_ALLOWLIST). */
export const DEMO_PATIENT_PROFILE: Readonly<IdentityProfile> = Object.freeze({
  firstName: 'Jordan', lastName: 'Demo', fullName: 'Jordan Demo', dateOfBirth: '1990-01-01',
  email: 'ronit-1977@agentmail.to', phone: '(202) 555-0100',
});

/** Splits "Jordan A. Demo" into first and last; a single word is a first name only. */
export function identityFromAccount(input: { legalName?: string | null; preferredName?: string | null; dateOfBirth?: string | null; email?: string | null; phone?: string | null; city?: string | null; state?: string | null; zip?: string | null }): IdentityProfile {
  const full = (input.legalName || input.preferredName || '').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  const out: IdentityProfile = {};
  if (full) out.fullName = full;
  if (parts.length) out.firstName = parts[0];
  if (parts.length > 1) out.lastName = parts[parts.length - 1];
  if (input.dateOfBirth) out.dateOfBirth = input.dateOfBirth;
  if (input.email) out.email = input.email;
  if (input.phone) out.phone = input.phone;
  if (input.city) out.city = input.city;
  if (input.state) out.state = input.state;
  if (input.zip) out.zip = input.zip;
  return out;
}

const PROFILE_KEY: Partial<Record<AnswerKind, keyof IdentityProfile>> = {
  email: 'email', date: 'dateOfBirth', phone: 'phone', first_name: 'firstName', last_name: 'lastName', full_name: 'fullName', city: 'city', state: 'state', zip: 'zip',
};

/**
 * Pre-fill for each question: the stored answer first (re-editing), then the profile (or demo patient), then an
 * earlier answer on this case for the same kind of question. A date question is pre-filled only when its label
 * says birth, so a "date of first symptoms" is never guessed.
 */
export function suggestAnswers(
  questions: readonly AnswerQuestion[],
  sources: { stored?: Readonly<Record<string, PatientAnswer>>; profile?: IdentityProfile | null; profileOrigin?: 'profile' | 'demo'; earlier?: readonly { label: string; kind: AnswerKind; value: string }[] },
): Record<string, AnswerSuggestion> {
  const out: Record<string, AnswerSuggestion> = {};
  for (const q of questions) {
    const stored = sources.stored?.[q.fieldKey];
    if (stored?.value) { out[q.fieldKey] = { value: stored.value, origin: stored.origin }; continue; }
    const key = PROFILE_KEY[q.kind];
    const birth = q.kind !== 'date' || /\bbirth|\bdob\b|birthday/i.test(q.label);
    const fromProfile = key && birth ? sources.profile?.[key] : undefined;
    if (fromProfile) { out[q.fieldKey] = { value: fromProfile, origin: sources.profileOrigin ?? 'profile' }; continue; }
    if (q.kind === 'text' || !birth) continue; // free-text questions are never carried over from another form
    const earlier = sources.earlier?.find(e => e.kind === q.kind && e.value);
    if (earlier) out[q.fieldKey] = { value: earlier.value, origin: 'earlier' };
  }
  return out;
}
