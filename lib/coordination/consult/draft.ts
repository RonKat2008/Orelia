import { AI_DISCLOSURE_EMAIL, withDisclosure } from '@/lib/safety/disclosure';
import { containsUnsharedField } from '@/lib/safety/minimize';
import { flagMedicalAdvice } from '@/lib/safety/no-medical-advice';
import type { CaseRecord } from '@/lib/safety/types';
import type { ConsultProcess, Doctor } from '../contract';

/**
 * Deterministic clinician-to-clinician consultation request. It contains ONLY the case fields the patient ticked
 * (plus, optionally, the included sections of the attached packet), the referring physician's approval line and the
 * AI disclosure. Text from the expert's web page is never copied into the message.
 */
export const FIELD_LABELS: Record<string, string> = {
  diseaseName: 'Diagnosis', subtype: 'Subtype', stageSummary: 'Stage summary', homeCity: 'Home city', homeState: 'Home state',
  insurer: 'Insurer', planId: 'Plan ID', travelLimitMiles: 'Travel limit (miles)', goals: 'Patient goals',
};
const GOAL_LABELS: Record<string, string> = { second_opinion: 'second opinion', treatment: 'treatment options', trial: 'clinical trial', support: 'support', aid: 'financial or travel aid' };

const ASK: Record<ConsultProcess['kind'], string> = {
  econsult: 'your physician-to-physician e-consult service',
  tumor_board: 'having this case considered at your tumor board or multidisciplinary case conference',
  case_review: 'an expert case review by your team',
  peer_to_peer: 'a peer-to-peer discussion with one of your specialists',
  referral_only: 'referring this patient to your team',
  unknown: 'a physician-to-physician consultation about this patient',
};

export function physicianApprovalLine(doctor: Pick<Doctor, 'name'>): string {
  return `The referring physician, ${doctor.name}, reviewed and approved this request before it was sent.`;
}

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const oneLine = (s: string) => s.replace(CONTROL, '').replace(/\s+/g, ' ').trim();

function fieldValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (key === 'goals' && Array.isArray(value)) return value.map(g => GOAL_LABELS[String(g)] ?? String(g)).join(', ') || null;
  if (Array.isArray(value)) return value.map(String).join(', ') || null;
  if (typeof value === 'object') return null;
  const s = oneLine(String(value));
  return s || null;
}

/** "- Label: value" for each ticked field that has a value, in a fixed order. */
export function sharedFieldLines(record: CaseRecord, sharedFields: readonly string[]): string[] {
  return Object.keys(FIELD_LABELS)
    .filter(key => sharedFields.includes(key))
    .flatMap(key => { const v = fieldValue(key, record[key]); return v ? [`- ${FIELD_LABELS[key]}: ${v}`] : []; });
}

/** Re-append the physician approval line and AI disclosure if an edit removed them. */
export function ensureFooter(body: string, doctor: Pick<Doctor, 'name'>): { body: string; added: boolean } {
  const line = physicianApprovalLine(doctor);
  let out = body.trimEnd();
  let added = false;
  if (!out.includes(line)) {
    // Keep the disclosure last.
    out = out.replace(AI_DISCLOSURE_EMAIL, '').trimEnd();
    out = `${out}\n\n${line}`;
    added = true;
  }
  if (!out.includes(AI_DISCLOSURE_EMAIL)) added = true;
  return { body: withDisclosure(out), added };
}

export interface ConsultDraftInput {
  expertName: string;
  process: ConsultProcess;
  doctor: Doctor;
  caseRecord: CaseRecord;
  sharedFields: readonly string[];
  /** renderPacketText(packet) of the attached packet (included sections only), or null. */
  packetText: string | null;
}

export function buildConsultDraft(input: ConsultDraftInput): { subject: string; body: string } {
  const diagnosis = input.sharedFields.includes('diseaseName') ? fieldValue('diseaseName', input.caseRecord.diseaseName) : null;
  const subject = diagnosis ? `Physician consultation request: ${diagnosis}` : 'Physician consultation request';
  const lines = sharedFieldLines(input.caseRecord, input.sharedFields);
  const practice = input.doctor.practice ? `, ${oneLine(input.doctor.practice)}` : '';
  const parts = [
    `Dear colleagues at ${oneLine(input.expertName)},`,
    `I am writing about a patient of mine to ask about ${ASK[input.process.kind]}.`,
    lines.length ? `Details the patient chose to share:\n${lines.join('\n')}` : 'The patient chose not to share case details in this first message. I can share more with the patient\'s permission.',
    ...(input.packetText ? [`Summary prepared with the patient (only the sections the patient selected):\n${input.packetText}`] : []),
    'Could you let me know whether your team could review this case, and what you would need from me to proceed (for example records, imaging or a formal referral)?',
    `Sincerely,\n${oneLine(input.doctor.name)}${practice}\nReferring physician`,
  ];
  return { subject, body: ensureFooter(parts.join('\n\n'), input.doctor).body };
}

export type ConsultDraftProblem = 'medical_advice' | 'unshared_field' | 'missing_footer';

/** Checks for text Wayfinder or the patient wrote (before the doctor approves it). */
export function draftProblems(draft: { subject: string; body: string }, record: CaseRecord, sharedFields: readonly string[], doctor: Pick<Doctor, 'name'>): ConsultDraftProblem[] {
  const text = `${draft.subject}\n${draft.body}`;
  const out: ConsultDraftProblem[] = [];
  if (flagMedicalAdvice(text).flagged) out.push('medical_advice');
  if (containsUnsharedField(text, record, sharedFields)) out.push('unshared_field');
  if (!draft.body.includes(AI_DISCLOSURE_EMAIL) || !draft.body.includes(physicianApprovalLine(doctor))) out.push('missing_footer');
  return out;
}

/** Optional LLM polish: kept only when it passes every draft check; otherwise the deterministic draft stands. */
export async function polishConsultDraft(
  draft: { subject: string; body: string },
  polisher: ((d: { subject: string; body: string }) => Promise<{ subject: string; body: string }>) | null,
  ctx: { record: CaseRecord; sharedFields: readonly string[]; doctor: Pick<Doctor, 'name'> },
): Promise<{ subject: string; body: string; polished: boolean }> {
  if (!polisher) return { ...draft, polished: false };
  try {
    const out = await polisher(draft);
    const candidate = { subject: oneLine(String(out.subject ?? '')).slice(0, 200), body: ensureFooter(String(out.body ?? ''), ctx.doctor).body };
    if (!candidate.subject || candidate.body.length > 8000) return { ...draft, polished: false };
    return draftProblems(candidate, ctx.record, ctx.sharedFields, ctx.doctor).length ? { ...draft, polished: false } : { ...candidate, polished: true };
  } catch {
    return { ...draft, polished: false };
  }
}

/** Email to the patient's doctor: the link, the expert's name and nothing from the case. */
export function doctorReviewEmail(input: { doctor: Pick<Doctor, 'name'>; expertName: string; url: string; expiresAt: string }): { subject: string; body: string } {
  const expert = oneLine(input.expertName);
  const until = input.expiresAt.slice(0, 10);
  const body = [
    `Hello ${oneLine(input.doctor.name)},`,
    `A patient of yours used Wayfinder to prepare a physician-to-physician consultation request to ${expert}. Nothing has been sent to ${expert}. It is sent only if you approve it and your patient then confirms.`,
    `Review, edit, approve or decline it here (the link works until ${until}):\n${input.url}`,
    'If you did not expect this message, you can ignore it.',
  ].join('\n\n');
  return { subject: `Please review a consultation request to ${expert}`, body: withDisclosure(body) };
}
