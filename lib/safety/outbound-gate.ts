import { isAllowed, normalizeAddress } from './allowlist';
import { activeContactCount, canFollowUp, MAX_ACTIVE_CONTACTS } from './caps';
import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE } from './disclosure';
import { containsUnsharedField, minimize } from './minimize';
import { flagMedicalAdvice } from './no-medical-advice';
import { exemptsAdviceFilter, type PhysicianAuthoredExemption } from './physician-exemption';
import type { CaseRecord, GateRefusal, SafetyConsent, SafetyContact, SafetyDraft, Timestamp } from './types';
import { checkWebFormDraft } from './web-gate';
export type { GateRefusal } from './types';
export interface OutboundInput {
  draft: SafetyDraft;
  caseRecord: CaseRecord;
  consent: SafetyConsent;
  contacts: readonly SafetyContact[];
  allowlist: readonly string[];
  now: Timestamp;
  mode: 'dev' | 'demo' | 'prod';
  /** Caller supplies OUTBOUND_ALLOW_REAL explicitly; never defaulted or read from environment here. */
  outboundAllowReal?: string;
  /** Parsed OUTBOUND_WEB_ALLOWLIST hosts (see parseWebAllowlist); only used for channel 'web_form'. */
  webAllowlist?: readonly string[];
  /**
   * Doctor-to-expert consult path only (minted by lib/safety/consult-gate.ts after verifying the physician approved
   * this exact text). Skips ONLY the medical-advice phrase filter for that exact email; see physician-exemption.ts.
   */
  physicianAuthored?: PhysicianAuthoredExemption;
}
const gated: unique symbol = Symbol('GatedDraft');
/** Only checkOutbound constructs this type. It is a snapshot of the approved content. */
export type GatedDraft = Readonly<SafetyDraft & {
  readonly [gated]: true;
  readonly approvedAt: string;
  readonly sharedFields: readonly string[];
  readonly caseData: CaseRecord;
  /** web_form only: document ids the patient ticked for upload. */
  readonly sharedDocIds?: readonly string[];
}>;
/** Every payload checkOutbound has produced. Membership, not shape, proves a draft is gated. */
const issued = new WeakSet<object>();

/** True only for objects minted by checkOutbound in this process; a look-alike frozen object is rejected. */
export function isGatedDraft(value: unknown): value is GatedDraft {
  return typeof value === 'object' && value !== null && issued.has(value);
}

export type OutboundResult = { ok: true; payload: GatedDraft } | { ok: false; reasons: GateRefusal[] };
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
function checkWebOutbound(input: OutboundInput, approvalTime: number, reasons: GateRefusal[]): OutboundResult {
  const { draft, caseRecord, consent } = input;
  for (const reason of checkWebFormDraft(input)) if (!reasons.includes(reason)) reasons.push(reason);
  if (reasons.length) return { ok: false, reasons };
  // Whitelist output keys; webForm is a deep copy so later caller mutation cannot change what was approved.
  const payload = deepFreeze({
    [gated]: true as const,
    channel: draft.channel, address: draft.address.trim(), body: draft.body,
    ...(draft.subject !== undefined ? { subject: draft.subject } : {}),
    ...(draft.contactId !== undefined ? { contactId: draft.contactId } : {}),
    ...(draft.caseId !== undefined ? { caseId: draft.caseId } : {}),
    approvedAt: new Date(approvalTime).toISOString(),
    sharedFields: [...consent.sharedFields],
    sharedDocIds: [...(consent.sharedDocIds ?? [])],
    caseData: minimize(caseRecord, consent.sharedFields),
    webForm: structuredClone(draft.webForm!),
  });
  issued.add(payload);
  return { ok: true, payload };
}
/** The contact replied after our last send, and both times are real and not in the future. */
function answersFreshReply(contact: SafetyContact, nowTime: number): boolean {
  if (!contact.lastSentAt || !contact.lastReplyAt) return false;
  const sent = new Date(contact.lastSentAt).getTime();
  const replied = new Date(contact.lastReplyAt).getTime();
  return Number.isFinite(sent) && Number.isFinite(replied) && replied > sent && replied <= nowTime;
}
export function checkOutbound(input: OutboundInput): OutboundResult {
  const { draft, caseRecord, consent, contacts, allowlist, now, mode } = input;
  const reasons: GateRefusal[] = [];
  const refuse = (reason: GateRefusal) => { if (!reasons.includes(reason)) reasons.push(reason); };
  const nowTime = new Date(now).getTime();
  const approvalTime = draft.approvedAt ? new Date(draft.approvedAt).getTime() : NaN;
  if (!Number.isFinite(approvalTime) || !Number.isFinite(nowTime) || approvalTime > nowTime) refuse('not_approved');
  if (draft.channel === 'web_form') return checkWebOutbound(input, approvalTime, reasons);
  const address = normalizeAddress(draft.address);
  if (!address || !draft.body.trim() || (draft.channel === 'email' ? !address.includes('@') : draft.channel !== 'voice' || !address.startsWith('+'))) refuse('invalid_draft');
  if (!(mode === 'prod' && input.outboundAllowReal === 'true') && !isAllowed(draft.address, allowlist)) refuse('not_allowlisted');

  const contact = draft.contactId
    ? contacts.find(item => item.id === draft.contactId)
    : contacts.find(item => item.address && normalizeAddress(item.address) === address);
  if ((draft.contactId && !contact) || (consent.contactId && consent.contactId !== draft.contactId)) refuse('consent_mismatch');
  if (contact) {
    if ((contact.address && normalizeAddress(contact.address) !== address) || (draft.caseId && contact.caseId && draft.caseId !== contact.caseId)) refuse('consent_mismatch');
    if (activeContactCount([contact]) === 0) refuse('inactive_contact');
  }
  if (!contact && activeContactCount(contacts) >= MAX_ACTIVE_CONTACTS) refuse('contact_cap');
  // A reply answers a request the contact made on this thread: it is exempt from the follow-up cadence only when
  // their reply is newer than our last send (so at most one answer per reply). Anything else is a follow-up.
  const answersReply = draft.isReply === true && !draft.isFollowUp && !!contact && answersFreshReply(contact, nowTime);
  const followUp = !answersReply && (draft.isFollowUp || (contact && (contact.state !== 'drafted' || !!contact.lastSentAt)));
  if (followUp && (!contact?.lastSentAt || contact.followUpsSent === undefined || !canFollowUp(contact.lastSentAt, contact.followUpsSent, now))) refuse('follow_up_cadence');

  // Subjects leave the system too and must meet the same privacy/content restrictions.
  const text = `${draft.subject ?? ''}\n${draft.body}`;
  if (containsUnsharedField(text, caseRecord, consent.sharedFields)) refuse('unshared_field');
  const disclosed = draft.channel === 'voice'
    ? draft.body.trimStart().startsWith(AI_DISCLOSURE_VOICE)
    : draft.body.includes(AI_DISCLOSURE_EMAIL);
  if (!disclosed) refuse('missing_disclosure');
  if (flagMedicalAdvice(text).flagged && !exemptsAdviceFilter(input.physicianAuthored, draft)) refuse('medical_advice');
  if (reasons.length || !address) return { ok: false, reasons };

  // Whitelist output keys: raw drafts cannot smuggle attachments or extra case data to adapters.
  const payload = deepFreeze({
    [gated]: true as const,
    channel: draft.channel, address: address, body: draft.body,
    ...(draft.subject !== undefined ? { subject: draft.subject } : {}),
    ...(draft.contactId !== undefined ? { contactId: draft.contactId } : {}),
    ...(draft.caseId !== undefined ? { caseId: draft.caseId } : {}),
    ...(draft.isFollowUp !== undefined ? { isFollowUp: draft.isFollowUp } : {}),
    approvedAt: new Date(approvalTime).toISOString(),
    sharedFields: [...consent.sharedFields],
    caseData: minimize(caseRecord, consent.sharedFields),
  });
  issued.add(payload);
  return { ok: true, payload };
}
