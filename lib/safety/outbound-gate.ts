import { isAllowed, normalizeAddress } from './allowlist';
import { activeContactCount, canFollowUp, MAX_ACTIVE_CONTACTS } from './caps';
import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE } from './disclosure';
import { containsUnsharedField, minimize } from './minimize';
import { flagMedicalAdvice } from './no-medical-advice';
import type { CaseRecord, GateRefusal, SafetyConsent, SafetyContact, SafetyDraft, Timestamp } from './types';
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
}
const gated: unique symbol = Symbol('GatedDraft');
/** Only checkOutbound constructs this type. It is a snapshot of the approved content. */
export type GatedDraft = Readonly<SafetyDraft & {
  readonly [gated]: true;
  readonly approvedAt: string;
  readonly sharedFields: readonly string[];
  readonly caseData: CaseRecord;
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
export function checkOutbound(input: OutboundInput): OutboundResult {
  const { draft, caseRecord, consent, contacts, allowlist, now, mode } = input;
  const reasons: GateRefusal[] = [];
  const refuse = (reason: GateRefusal) => { if (!reasons.includes(reason)) reasons.push(reason); };
  const nowTime = new Date(now).getTime();
  const approvalTime = draft.approvedAt ? new Date(draft.approvedAt).getTime() : NaN;
  if (!Number.isFinite(approvalTime) || !Number.isFinite(nowTime) || approvalTime > nowTime) refuse('not_approved');
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
  const followUp = draft.isFollowUp || (contact && (contact.state !== 'drafted' || !!contact.lastSentAt));
  if (followUp && (!contact?.lastSentAt || contact.followUpsSent === undefined || !canFollowUp(contact.lastSentAt, contact.followUpsSent, now))) refuse('follow_up_cadence');

  // Subjects leave the system too and must meet the same privacy/content restrictions.
  const text = `${draft.subject ?? ''}\n${draft.body}`;
  if (containsUnsharedField(text, caseRecord, consent.sharedFields)) refuse('unshared_field');
  const disclosed = draft.channel === 'voice'
    ? draft.body.trimStart().startsWith(AI_DISCLOSURE_VOICE)
    : draft.body.includes(AI_DISCLOSURE_EMAIL);
  if (!disclosed) refuse('missing_disclosure');
  if (flagMedicalAdvice(text).flagged) refuse('medical_advice');
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
