/**
 * The spoken script for a verification call. It begins with the AI disclosure, asks only the fixed questions in
 * contract.ts, and states only the fields the patient ticked (diagnosis name; insurer only when ticked).
 *
 * Insurance when the insurer is NOT ticked: the question is skipped (answer 'not_asked'). Asking "do you accept most
 * major insurance plans?" shares nothing, but a "yes" would read as a badge the patient could mistake for "my plan
 * is accepted", so the safer option is not to ask.
 */
import { neutralizeUntrusted } from '../agents/research/untrusted';
import { AI_DISCLOSURE_VOICE } from '../safety/disclosure';
import { containsUnsharedField, minimize } from '../safety/minimize';
import { flagMedicalAdvice } from '../safety/no-medical-advice';
import type { CaseRecord } from '../safety/types';
import { verifySharedFieldsSchema, type VerifyQuestionKey } from './contract';

export type VerifySharedField = 'diseaseName' | 'insurer';

export interface VerifyQuestion { key: VerifyQuestionKey; text: string }

export interface VerifyScriptInput {
  /** Resource name; only spoken when it cannot leak an unshared case value (see safeName). */
  name: string;
  record: CaseRecord;
  sharedFields: readonly VerifySharedField[];
}

export const UNSHARED_FALLBACK = "I'll have the patient follow up.";
export const MEDICAL_FALLBACK = "I can't answer medical questions. The patient will discuss those with their care team.";
const MAX_NAME = 120;
const REDACT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/\S+|\bwww\.\S+|\+?\d[\d\s().-]{7,}\d/gi;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null);

/** The shared values the script may say, after minimize(); throws when the diagnosis name is missing. */
export function sharedValues(record: CaseRecord, sharedFields: readonly VerifySharedField[]): { diseaseName: string; insurer: string | null } {
  const fields = verifySharedFieldsSchema.parse([...sharedFields]);
  const data = minimize(record, fields);
  const diseaseName = text(data.diseaseName);
  if (!diseaseName) throw new Error('diseaseName is required for a verification call');
  return { diseaseName, insurer: fields.includes('insurer') ? text(data.insurer) : null };
}

/** The questions actually asked, in order. Insurance only when the insurer was ticked and is known. */
export function verifyQuestions(record: CaseRecord, sharedFields: readonly VerifySharedField[]): VerifyQuestion[] {
  const { diseaseName, insurer } = sharedValues(record, sharedFields);
  const questions: VerifyQuestion[] = [
    { key: 'treats_condition', text: `Does your team treat patients with ${diseaseName}?` },
    { key: 'new_adult_patients', text: 'Are you currently accepting new adult patients?' },
    { key: 'referral_required', text: 'Is a referral from another doctor needed for a first appointment?' },
    { key: 'consultations', text: 'Do you offer consultations or second opinions?' },
    { key: 'how_to_start', text: 'How does a new patient get started?' },
  ];
  if (insurer) questions.push({ key: 'insurance', text: `Do you accept ${insurer} insurance? A yes or no is enough.` });
  return questions;
}

/** A third-party name is untrusted: neutralized, contact details redacted, and dropped if it echoes an unshared value. */
function safeName(name: string, record: CaseRecord, sharedFields: readonly string[]): string | null {
  const clean = neutralizeUntrusted(name).replace(REDACT, '').replace(/["\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  if (!clean || clean.includes('[removed')) return null;
  if (containsUnsharedField(clean, record, sharedFields) || flagMedicalAdvice(clean).flagged) return null;
  return clean;
}

/** Rendered script; begins EXACTLY with AI_DISCLOSURE_VOICE. Approval and checkOutbound happen at call time. */
export function createVerifyScript(input: VerifyScriptInput): string {
  const { diseaseName, insurer } = sharedValues(input.record, input.sharedFields);
  const name = safeName(input.name, input.record, input.sharedFields);
  const questions = verifyQuestions(input.record, input.sharedFields);
  const facts = [`- Diagnosis: ${diseaseName}`, ...(insurer ? [`- Insurance: ${insurer}`] : [])];
  return [
    AI_DISCLOSURE_VOICE,
    `Purpose: a short call to ${name ? `the office of ${name}` : 'this office'} to confirm how new patients can be seen, so the patient knows whether and how to reach out. Only yes-or-no questions and one question about how to get started.`,
    `Details the patient approved for sharing (share only these, and only if asked):\n${facts.join('\n')}`,
    `Ask these questions one at a time and wait for each answer:\n${questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')}`,
    'Do not ask any other questions.',
    `If asked anything not in the approved details, say: "${UNSHARED_FALLBACK}"`,
    `If asked a medical or clinical question, say: "${MEDICAL_FALLBACK}"`,
    'Never give medical advice, make promises, or say how soon the patient needs to be seen.',
    'Close with: "Thank you for your time. The patient will follow up."',
  ].join('\n\n');
}
