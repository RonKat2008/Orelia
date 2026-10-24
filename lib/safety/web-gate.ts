import { activeContactCount, activeTargetIds, MAX_ACTIVE_CONTACTS } from './caps';
import { AI_DISCLOSURE_EMAIL } from './disclosure';
import { sameFieldValue } from './field-value';
import { containsUnsharedField } from './minimize';
import { flagMedicalAdvice } from './no-medical-advice';
import { isWebAllowed } from './web-allowlist';
import type { CaseRecord, GateRefusal, SafetyConsent, SafetyContact, SafetyDraft, WebFormDraftPayload } from './types';

export interface WebGateInput {
  readonly draft: SafetyDraft;
  readonly caseRecord: CaseRecord;
  readonly consent: SafetyConsent;
  readonly contacts: readonly SafetyContact[];
  readonly webAllowlist?: readonly string[];
  readonly mode: 'dev' | 'demo' | 'prod';
  readonly outboundAllowReal?: string;
}

function isHttpUrl(address: string): boolean {
  try {
    const { protocol } = new URL(address);
    return protocol === 'https:' || protocol === 'http:';
  } catch { return false; }
}

const sameUrl = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function checkFieldSources(form: WebFormDraftPayload, input: WebGateInput, refuse: (r: GateRefusal) => void): void {
  const { caseRecord, consent } = input;
  const docIds = consent.sharedDocIds ?? [];
  for (const field of form.fields) {
    const { source } = field;
    if (source.kind === 'consent') {
      if (!consent.sharedFields.includes(source.key)) refuse('unshared_field');
      else if (!Object.hasOwn(caseRecord, source.key) || !sameFieldValue(field.value, caseRecord[source.key])) refuse('consent_mismatch');
    } else if (source.kind === 'doc') {
      if (!docIds.includes(source.docId)) refuse('unshared_field');
    } else if (source.kind === 'disclosure') {
      if (typeof field.value !== 'string' || !field.value.includes(AI_DISCLOSURE_EMAIL)) refuse('missing_disclosure');
    } else {
      refuse('invalid_draft');
    }
  }
  if (form.uploads.some(upload => !docIds.includes(upload.docId))) refuse('unshared_field');
  if (form.hasFreeText && !form.fields.some(f => f.type === 'textarea' && typeof f.value === 'string' && f.value.includes(AI_DISCLOSURE_EMAIL))) refuse('missing_disclosure');
}

function checkContact(input: WebGateInput, address: string, refuse: (r: GateRefusal) => void): void {
  const { draft, consent, contacts } = input;
  const contact = draft.contactId
    ? contacts.find(item => item.id === draft.contactId)
    : contacts.find(item => item.address && sameUrl(item.address, address));
  if ((draft.contactId && !contact) || (consent.contactId && consent.contactId !== draft.contactId)) refuse('consent_mismatch');
  if (contact) {
    if ((contact.address && !sameUrl(contact.address, address)) || (draft.caseId && contact.caseId && draft.caseId !== contact.caseId)) refuse('consent_mismatch');
    if (activeContactCount([contact]) === 0) refuse('inactive_contact');
  }
  if (contact) return;
  // The cap is on resources: an application to a resource the patient already actively contacts is not new.
  const active = activeTargetIds(contacts);
  if (draft.targetId && active.has(`t:${draft.targetId}`)) return;
  if (active.size >= MAX_ACTIVE_CONTACTS) refuse('contact_cap');
}

/**
 * Web-form rules other than approval (checked by checkOutbound). Returns every refusal found.
 * Follow-up cadence does not apply to web forms.
 */
export function checkWebFormDraft(input: WebGateInput): GateRefusal[] {
  const { draft, caseRecord, consent } = input;
  const reasons: GateRefusal[] = [];
  const refuse = (reason: GateRefusal) => { if (!reasons.includes(reason)) reasons.push(reason); };
  const address = draft.address.trim();
  const form = draft.webForm;
  const validUrl = isHttpUrl(address);
  if (!validUrl || !form || !Array.isArray(form.fields) || form.fields.length === 0 || !Array.isArray(form.uploads)) refuse('invalid_draft');
  if (!(input.mode === 'prod' && input.outboundAllowReal === 'true') && !isWebAllowed(address, input.webAllowlist ?? [])) refuse('not_allowlisted');
  checkContact(input, address, refuse);
  if (!form || !Array.isArray(form.fields) || !Array.isArray(form.uploads)) return reasons;

  checkFieldSources(form, input, refuse);
  const text = [...form.fields.map(f => f.value).filter((v): v is string => typeof v === 'string'), draft.subject ?? '', draft.body].join('\n');
  if (containsUnsharedField(text, caseRecord, consent.sharedFields)) refuse('unshared_field');
  if (flagMedicalAdvice(text).flagged) refuse('medical_advice');
  return reasons;
}
