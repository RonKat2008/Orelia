import { createHash } from 'node:crypto';
import { parseContactPoints } from '../contact-finder/contact-points';
import { normalizeAddress } from './allowlist';
import { activeTargetIds, MAX_ACTIVE_CONTACTS } from './caps';
import { isFreeMailAddress } from './free-mail';
import { checkOutbound, type GatedDraft } from './outbound-gate';
import { mintPhysicianExemption } from './physician-exemption';
import type { CaseRecord, GateRefusal, SafetyContact, Timestamp } from './types';

/**
 * Doctor-to-expert consultation gate. A consult request may reach the expert only when ALL of these hold, and then
 * only through checkOutbound (whose checks all still run):
 *  - status is doctor_approved or ready;
 *  - the patient's doctor approved it (doctorApprovedAt <= now);
 *  - the patient consented AFTER that approval (doctorApprovedAt <= patientConsentAt <= now);
 *  - the destination and text are byte-for-byte what the doctor approved (consultTextHash({to, subject, body}));
 *  - no control characters in the subject (header injection) or body (other than tab / newline);
 *  - the expert address is a code-stamped, tool-sourced contact point (evidence row addressEvidenceId);
 *  - the resource fits the <=5 active resources cap (contacts at the same resource count once).
 * The physician exemption from the medical-advice filter is minted ONLY when the approver is verified (NPI matched
 * the doctor's name in NPPES at add time), is not on a free-mail domain, and the message names the approver's email
 * and NPI so the expert can check them. Otherwise the request still goes, but through the standard filter.
 * Only lib/coordination/consult/service.ts calls this, after verifying the approval HMAC (tests/safety scan).
 * Pure: no environment, network or database access.
 */
export type ConsultGateRefusal =
  | 'consult_not_ready'
  | 'no_doctor_approval'
  | 'no_patient_consent'
  | 'consent_before_doctor_approval'
  | 'text_changed_after_approval'
  | 'no_expert_address'
  | 'address_not_evidence_backed'
  | 'contact_cap'
  | 'control_characters';

/** Who approved the text (frozen into the consult at decision time). */
export interface ConsultApprover {
  readonly email: string;
  readonly npi: string | null;
  readonly verified: boolean;
}

export interface ConsultGateEvidence {
  readonly id: string;
  readonly claimType: string;
  readonly claim: string;
  readonly sourceUrl: string;
  readonly sourceKind?: string;
}

export interface ConsultGateConsult {
  readonly caseId: string;
  /** The resource's target id (the part after `kind:` in resourceKey). */
  readonly targetId: string;
  readonly status: string;
  readonly subject: string;
  readonly body: string;
  readonly sharedFields: readonly string[];
  readonly doctorApprovedAt: string | null;
  readonly patientConsentAt: string | null;
  readonly approvedBodyHash: string | null;
  readonly expertAddress: string | null;
  readonly addressEvidenceId: string | null;
  readonly approver: ConsultApprover | null;
}

export interface ConsultGateInput {
  consult: ConsultGateConsult;
  /** The resource's stored evidence rows (tool output); the address must be one of its contact points. */
  evidence: readonly ConsultGateEvidence[];
  caseRecord: CaseRecord;
  contacts: readonly SafetyContact[];
  allowlist: readonly string[];
  now: Timestamp;
  mode: 'dev' | 'demo' | 'prod';
  outboundAllowReal?: string;
}

export type ConsultGateResult = { ok: true; payload: GatedDraft } | { ok: false; reasons: (ConsultGateRefusal | GateRefusal)[] };

/** sha256 hex of the canonical JSON {body, subject, to} (sorted keys, normalized address): what the doctor approved. */
export function consultTextHash(input: { to: string | null; subject: string; body: string }): string {
  const to = (input.to && normalizeAddress(input.to)) || '';
  return createHash('sha256').update(JSON.stringify({ body: input.body, subject: input.subject, to }), 'utf8').digest('hex');
}

export const SUBJECT_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
export const BODY_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** The exemption needs a verified, non-free-mail approver whose email and NPI are named in the message. */
function exemptionEligible(approver: ConsultApprover | null, body: string): approver is ConsultApprover & { npi: string } {
  if (!approver || !approver.verified || !approver.npi || !/^\d{10}$/.test(approver.npi)) return false;
  const email = normalizeAddress(approver.email);
  if (!email || isFreeMailAddress(email)) return false;
  return body.toLowerCase().includes(email) && body.includes(`NPI ${approver.npi}`);
}

const time = (value: Timestamp | null | undefined): number => (value ? new Date(value).getTime() : NaN);

/** The address only counts when an evidence row with that id is a valid email contact point for exactly it. */
function evidenceBacked(address: string, evidenceId: string | null, evidence: readonly ConsultGateEvidence[]): boolean {
  if (!evidenceId) return false;
  const row = evidence.find(e => e.id === evidenceId);
  if (!row) return false;
  return parseContactPoints([row]).some(p => p.channel === 'email' && p.address === address);
}

export function checkConsultOutbound(input: ConsultGateInput): ConsultGateResult {
  const { consult } = input;
  const reasons: (ConsultGateRefusal | GateRefusal)[] = [];
  const refuse = (r: ConsultGateRefusal | GateRefusal) => { if (!reasons.includes(r)) reasons.push(r); };
  const now = time(input.now);
  const approvedAt = time(consult.doctorApprovedAt);
  const consentAt = time(consult.patientConsentAt);

  if (consult.status !== 'doctor_approved' && consult.status !== 'ready') refuse('consult_not_ready');
  if (!Number.isFinite(now) || !Number.isFinite(approvedAt) || approvedAt > now) refuse('no_doctor_approval');
  if (!Number.isFinite(consentAt) || consentAt > now) refuse('no_patient_consent');
  else if (Number.isFinite(approvedAt) && consentAt < approvedAt) refuse('consent_before_doctor_approval');
  const address = consult.expertAddress ? normalizeAddress(consult.expertAddress) : null;
  if (!consult.approvedBodyHash || consultTextHash({ to: address, subject: consult.subject, body: consult.body }) !== consult.approvedBodyHash) refuse('text_changed_after_approval');
  if (SUBJECT_CONTROL.test(consult.subject) || BODY_CONTROL.test(consult.body)) refuse('control_characters');

  if (!address) refuse('no_expert_address');
  else if (!evidenceBacked(address, consult.addressEvidenceId, input.evidence)) refuse('address_not_evidence_backed');

  // Cap per resource (as the web gate does): an already-active resource is not a new contact.
  const active = activeTargetIds(input.contacts);
  if (!active.has(`t:${consult.targetId}`) && active.size >= MAX_ACTIVE_CONTACTS) refuse('contact_cap');

  if (reasons.length || !address) return { ok: false, reasons };

  // Same-resource contacts at OTHER addresses are left out of checkOutbound only so its per-row cap does not count
  // the resource twice (re-enforced per resource above). A same-address contact stays in: its state and follow-up
  // cadence still apply.
  const contacts = input.contacts.filter(c => !(c.targetId === consult.targetId && (!c.address || normalizeAddress(c.address) !== address)));
  const exemption = exemptionEligible(consult.approver, consult.body) ? mintPhysicianExemption({ address, subject: consult.subject, body: consult.body }) : null;
  const gate = checkOutbound({
    draft: { channel: 'email', address, subject: consult.subject, body: consult.body, caseId: consult.caseId, approvedAt: consult.patientConsentAt },
    consent: { sharedFields: [...consult.sharedFields] },
    caseRecord: input.caseRecord,
    contacts,
    allowlist: input.allowlist,
    now: input.now,
    mode: input.mode,
    ...(input.outboundAllowReal !== undefined ? { outboundAllowReal: input.outboundAllowReal } : {}),
    ...(exemption ? { physicianAuthored: exemption } : {}),
  });
  return gate.ok ? gate : { ok: false, reasons: [...gate.reasons] };
}
