import { createHash } from 'node:crypto';
import { parseContactPoints } from '../contact-finder/contact-points';
import { normalizeAddress } from './allowlist';
import { activeTargetIds, MAX_ACTIVE_CONTACTS } from './caps';
import { checkOutbound, type GatedDraft } from './outbound-gate';
import { mintPhysicianExemption } from './physician-exemption';
import type { CaseRecord, GateRefusal, SafetyContact, Timestamp } from './types';

/**
 * Doctor-to-expert consultation gate. A consult request may reach the expert only when ALL of these hold, and then
 * only through checkOutbound (whose checks all still run):
 *  - status is doctor_approved or ready;
 *  - the patient's doctor approved it (doctorApprovedAt <= now);
 *  - the patient consented AFTER that approval (doctorApprovedAt <= patientConsentAt <= now);
 *  - the text is byte-for-byte what the doctor approved (sha256(`${subject}\n${body}`) === approvedBodyHash);
 *  - the expert address is a code-stamped, tool-sourced contact point (evidence row addressEvidenceId);
 *  - the resource fits the <=5 active resources cap (contacts at the same resource count once).
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
  | 'contact_cap';

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

/** sha256 hex of exactly `${subject}\n${body}`: what the doctor approved. */
export function consultTextHash(subject: string, body: string): string {
  return createHash('sha256').update(`${subject}\n${body}`, 'utf8').digest('hex');
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
  if (!consult.approvedBodyHash || consultTextHash(consult.subject, consult.body) !== consult.approvedBodyHash) refuse('text_changed_after_approval');

  const address = consult.expertAddress ? normalizeAddress(consult.expertAddress) : null;
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
  const exemption = mintPhysicianExemption({ address, subject: consult.subject, body: consult.body });
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
