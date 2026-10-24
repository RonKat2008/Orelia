import { createHash } from 'node:crypto';
import { normalizeAddress, parseAllowlist } from '@/lib/safety/allowlist';
import { BODY_CONTROL, checkConsultOutbound, consultTextHash, SUBJECT_CONTROL } from '@/lib/safety/consult-gate';
import { checkRateLimit, getRateLimitStore, type RateLimitStore, type RateRule } from '@/lib/rate-limit';
import { containsUnsharedField } from '@/lib/safety/minimize';
import { checkOutbound, type GatedDraft } from '@/lib/safety/outbound-gate';
import type { CaseRecord } from '@/lib/safety/types';
import type { PlanResourceInput } from '@/lib/plan/contract';
import {
  consultRequestSchema, doctorNameSchema, doctorPracticeSchema, doctorSchema, npiSchema,
  type ConsultRequest, type CoordinationStore, type Doctor, type ReviewDecisionBody, type ReviewView, type TargetKind,
} from '../contract';
import { includedSections, renderPacketText } from '../packet/render';
import type { ExaSearcher } from '../requirements/deps';
import { trustedDoctorDomains, type DomainEvidenceRow } from './doctor-domain';
import { doctorEmailRefused, verifyDoctor, type DoctorVerifier } from './doctor-verify';
import { buildConsultDraft, doctorReviewEmail, draftProblems, ensureFooter, FIELD_LABELS } from './draft';
import { discoverConsultProcess } from './process';
import { appBaseUrl, approvalMac, mintReviewToken, reviewUrl, sameHash, verifyApprovalMac, verifyReviewToken, type ApprovalFields } from './token';
import type { ConsultTracker } from './tracker';

type Env = Record<string, string | undefined>;

export interface ConsultEmailChannel { send(gated: GatedDraft): Promise<{ messageId?: string; threadId?: string }> }

export interface ConsultDeps {
  store: CoordinationStore;
  loadInputs(caseId: string): Promise<PlanResourceInput[]>;
  caseRecord(caseId: string): Promise<CaseRecord | null>;
  tracker: ConsultTracker;
  /** Email channel (mock in dev/tests, AgentMail when configured). Accepts only gate-minted payloads. */
  email(): ConsultEmailChannel;
  exa: ExaSearcher | null;
  env: Env;
  now(): Date;
  /** NPPES-backed doctor verifier; null (offline / unavailable) leaves every doctor unverified. */
  verifier?: DoctorVerifier | null;
  /** The patient's own notification email (cases.patient_email): never accepted as a doctor email. */
  patientEmail?(caseId: string): Promise<string | null>;
  /** Fixed-window counters (rate_limits table in prod). Defaults to the process-wide store. */
  rateLimits?: RateLimitStore;
  /**
   * Code-stamped evidence on this case for the doctor's NPI (their expert rows and institution). A doctor is verified
   * only when their email domain matches it; missing means no doctor is verified.
   */
  doctorDomainEvidence?(caseId: string, npi: string): Promise<DoctorDomainEvidence[]>;
}

export type DoctorDomainEvidence = DomainEvidenceRow;

/** Audit context of the doctor's decision request: hashed, never stored raw. */
export interface ReviewAudit { ip: string; userAgent: string }

export const MAX_DOCTORS_PER_CASE = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Review-link emails: at most 3 per consult and 10 per case per day (security review #2). */
export const SEND_TO_DOCTOR_LIMITS = (caseId: string, consultId: string): RateRule[] => [
  { key: `consult:review-email:consult:${consultId}`, max: 3, windowMs: DAY_MS },
  { key: `consult:review-email:case:${caseId}`, max: 10, windowMs: DAY_MS },
];

export const auditHash = (a: ReviewAudit): string => createHash('sha256').update(JSON.stringify([a.ip, a.userAgent]), 'utf8').digest('hex');

/** status + generic message; reasons are refusal codes only (never case data). */
export class ConsultError extends Error {
  constructor(readonly status: number, message: string, readonly reasons?: string[]) { super(message); this.name = 'ConsultError'; }
}

const ACTIVE = new Set<ConsultRequest['status']>(['drafted', 'sent_to_doctor', 'doctor_approved', 'ready']);
const FIELD_KEYS = new Set(Object.keys(FIELD_LABELS));

/** The client never sees the token hash. */
export function stripConsult(c: ConsultRequest): ConsultRequest {
  return { ...c, reviewTokenHash: null };
}

const mode = (env: Env): 'dev' | 'prod' => (env.NODE_ENV === 'production' ? 'prod' : 'dev');
const targetOf = (resourceKey: string): { targetKind: TargetKind; targetId: string } => {
  const i = resourceKey.indexOf(':');
  return { targetKind: resourceKey.slice(0, i) as TargetKind, targetId: resourceKey.slice(i + 1) };
};

export interface NewDoctorInput { name: string; practice?: string; email: string; npi?: string }
export interface NewConsultInput { resourceKey: string; doctorId: string; packetId?: string | null; sharedFields: string[] }
export interface ConsultPatch { version: number; action: 'edit' | 'send_to_doctor' | 'consent' | 'send' | 'cancel'; subject?: string; body?: string }

export class ConsultService {
  constructor(private readonly deps: ConsultDeps) {}

  private iso() { return this.deps.now().toISOString(); }

  // ------------------------------------------------------------------ doctors

  async listDoctors(caseId: string): Promise<Doctor[]> {
    return (await this.deps.store.list(caseId, 'doctor')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async emailRefused(caseId: string, email: string): Promise<boolean> {
    const patientEmail = this.deps.patientEmail ? await this.deps.patientEmail(caseId) : null;
    return doctorEmailRefused(email, { patientEmail, env: this.deps.env });
  }

  async addDoctor(caseId: string, body: NewDoctorInput): Promise<Doctor> {
    const name = doctorNameSchema.safeParse(body.name);
    const practice = body.practice?.trim() ? doctorPracticeSchema.safeParse(body.practice) : null;
    const npiRaw = body.npi?.replace(/\s/g, '') ?? '';
    const npi = npiRaw ? npiSchema.safeParse(npiRaw) : null;
    if (!name.success || (practice && !practice.success) || (npi && !npi.success)) throw new ConsultError(400, 'Check the doctor\'s name, practice and NPI (no links; NPI is 10 digits)');
    const email = body.email.trim().toLowerCase();
    if (await this.emailRefused(caseId, email)) {
      throw new ConsultError(422, 'Use your doctor\'s own practice email, not yours or a Wayfinder address', ['doctor_email_not_allowed']);
    }
    if ((await this.deps.store.list(caseId, 'doctor')).length >= MAX_DOCTORS_PER_CASE) throw new ConsultError(409, `You can add up to ${MAX_DOCTORS_PER_CASE} doctors`);
    const npiValue = npi?.success ? npi.data : null;
    const trustedDomains = npiValue ? await this.trustedDomains(caseId, npiValue) : [];
    const check = await verifyDoctor(this.deps.verifier ?? null, { name: name.data, npi: npiValue, email, trustedDomains });
    const doctor = doctorSchema.parse({
      id: crypto.randomUUID(), caseId, name: name.data, practice: practice?.success ? practice.data : null, email,
      npi: npiValue, verified: check.verified, verificationReason: check.reason, createdAt: this.iso(),
    });
    const saved = await this.deps.store.save(caseId, 'doctor', doctor.id, doctor);
    if (!saved) throw new ConsultError(500, 'Unable to save the doctor');
    return saved;
  }

  private async trustedDomains(caseId: string, npi: string): Promise<string[]> {
    if (!this.deps.doctorDomainEvidence) return [];
    try {
      return trustedDoctorDomains(await this.deps.doctorDomainEvidence(caseId, npi));
    } catch (err) {
      console.error('[consult] doctor domain evidence lookup failed', err instanceof Error ? err.name : 'error');
      return [];
    }
  }

  async removeDoctor(caseId: string, doctorId: string): Promise<void> {
    if (!await this.deps.store.get(caseId, 'doctor', doctorId)) throw new ConsultError(404, 'Doctor not found');
    const consults = await this.deps.store.list(caseId, 'consult');
    if (consults.some(c => c.doctorId === doctorId && ACTIVE.has(c.status))) throw new ConsultError(409, 'This doctor is reviewing an active consultation request; cancel it first');
    await this.deps.store.remove(caseId, 'doctor', doctorId);
  }

  // ------------------------------------------------------------------ consults (patient side)

  async listConsults(caseId: string): Promise<ConsultRequest[]> {
    return (await this.deps.store.list(caseId, 'consult')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(stripConsult);
  }

  async create(caseId: string, input: NewConsultInput): Promise<ConsultRequest> {
    const { store } = this.deps;
    const unknown = input.sharedFields.filter(f => !FIELD_KEYS.has(f));
    if (unknown.length) throw new ConsultError(400, 'Unknown shared field');
    const sharedFields = [...new Set(input.sharedFields)];
    const doctor = await store.get(caseId, 'doctor', input.doctorId);
    if (!doctor) throw new ConsultError(404, 'Doctor not found');
    const resource = (await this.deps.loadInputs(caseId)).find(r => `${r.targetKind}:${r.targetId}` === input.resourceKey);
    if (!resource) throw new ConsultError(422, 'Choose one of your selected resources');
    const record = await this.deps.caseRecord(caseId);
    if (!record) throw new ConsultError(404, 'Case not found');
    let packetText: string | null = null;
    let packetSnapshot: ConsultRequest['packetSnapshot'] = null;
    if (input.packetId) {
      const packet = await store.get(caseId, 'packet', input.resourceKey);
      if (!packet || packet.id !== input.packetId) throw new ConsultError(404, 'Packet not found');
      const sections = includedSections(packet);
      packetText = sections.length ? renderPacketText(packet) : null;
      packetSnapshot = sections.length ? structuredClone(sections) : null;
    }
    const process = await discoverConsultProcess(resource, { exa: this.deps.exa });
    if (!process) throw new ConsultError(422, 'No source page is available for this resource yet');
    const draft = buildConsultDraft({ expertName: resource.name, process, doctor, caseRecord: record, sharedFields, packetText });
    const problems = draftProblems(draft, record, sharedFields, doctor);
    if (problems.length) throw new ConsultError(422, 'The request includes details you did not choose to share; tick them or detach the packet', problems);
    const now = this.iso();
    const consult = consultRequestSchema.parse({
      id: crypto.randomUUID(), caseId, resourceKey: input.resourceKey, expertName: resource.name.slice(0, 200), doctorId: doctor.id, process,
      subject: draft.subject, body: draft.body, packetId: input.packetId ?? null, sharedFields, status: 'drafted',
      reviewTokenHash: null, reviewTokenExpiresAt: null, reviewTokenEmail: null, reviewTokenUsedAt: null, sentToDoctorAt: null, doctorEdited: false, doctorApprovedAt: null, doctorDeclinedAt: null,
      doctorNote: null, approvedBodyHash: null, approvedBy: null, doctorApprovalAudit: null, approvalMac: null, packetSnapshot, patientConsentAt: null, sentAt: null, providerMessageId: null, failureReasons: [],
      version: 1, createdAt: now, updatedAt: now,
    });
    const saved = await store.save(caseId, 'consult', consult.id, consult);
    if (!saved) throw new ConsultError(500, 'Unable to save the request');
    return stripConsult(saved);
  }

  async patch(caseId: string, consultId: string, patch: ConsultPatch): Promise<ConsultRequest> {
    const current = await this.deps.store.get(caseId, 'consult', consultId);
    if (!current) throw new ConsultError(404, 'Request not found');
    if (current.version !== patch.version) throw new ConsultError(409, 'The request changed; reload and try again');
    switch (patch.action) {
      case 'edit': return stripConsult(await this.edit(current, patch));
      case 'send_to_doctor': return stripConsult(await this.sendToDoctor(current));
      case 'consent': return stripConsult(await this.consent(current));
      case 'send': return stripConsult(await this.send(current));
      case 'cancel': return stripConsult(await this.cancel(current));
    }
  }

  private async save(next: ConsultRequest, expected: number): Promise<ConsultRequest> {
    const saved = await this.deps.store.save(next.caseId, 'consult', next.id, { ...next, version: expected + 1, updatedAt: this.iso() }, expected);
    if (!saved) throw new ConsultError(409, 'The request changed; reload and try again');
    return saved;
  }

  private async doctorOf(c: ConsultRequest): Promise<Doctor> {
    const doctor = await this.deps.store.get(c.caseId, 'doctor', c.doctorId);
    if (!doctor) throw new ConsultError(404, 'Doctor not found');
    return doctor;
  }

  private async recordOf(caseId: string): Promise<CaseRecord> {
    const record = await this.deps.caseRecord(caseId);
    if (!record) throw new ConsultError(404, 'Case not found');
    return record;
  }

  private async edit(c: ConsultRequest, patch: ConsultPatch): Promise<ConsultRequest> {
    if (c.status !== 'drafted') throw new ConsultError(409, 'The request can only be edited before it goes to your doctor');
    const subject = patch.subject?.trim();
    if (!subject || !patch.body?.trim()) throw new ConsultError(400, 'Subject and message are required');
    if (SUBJECT_CONTROL.test(subject) || BODY_CONTROL.test(patch.body)) throw new ConsultError(400, 'The subject cannot contain line breaks, and the message cannot contain control characters', ['control_characters']);
    const doctor = await this.doctorOf(c);
    const body = ensureFooter(patch.body, doctor).body;
    if (subject.length > 200 || body.length > 8000) throw new ConsultError(400, 'The message is too long');
    const problems = draftProblems({ subject, body }, await this.recordOf(c.caseId), c.sharedFields, doctor);
    if (problems.length) throw new ConsultError(422, 'This edit cannot be used', problems);
    return this.save({ ...c, subject, body }, c.version);
  }

  /** Patient approves emailing the review link. Itself outbound: approved_at = now, through checkOutbound. */
  private async sendToDoctor(c: ConsultRequest): Promise<ConsultRequest> {
    if (c.status !== 'drafted' && c.status !== 'sent_to_doctor') throw new ConsultError(409, 'The review link can only be sent before your doctor decides');
    const doctor = await this.doctorOf(c);
    if (await this.emailRefused(c.caseId, doctor.email)) {
      throw new ConsultError(422, 'Use your doctor\'s own practice email, not yours or a Wayfinder address', ['doctor_email_not_allowed']);
    }
    const record = await this.recordOf(c.caseId);
    const now = this.deps.now();
    const limit = await checkRateLimit(this.deps.rateLimits ?? getRateLimitStore(), SEND_TO_DOCTOR_LIMITS(c.caseId, c.id), now);
    if (!limit.ok) throw new ConsultError(429, 'Too many review emails today; try again tomorrow', ['rate_limited']);
    const minted = mintReviewToken(now, this.deps.env);
    const mail = doctorReviewEmail({ doctor, expertName: c.expertName, url: reviewUrl(appBaseUrl(this.deps.env), minted.token), expiresAt: minted.expiresAt });
    // The patient's own doctor is not an outreach contact (no case data in this email): contact cap not applied here.
    const gate = checkOutbound({
      draft: { channel: 'email', address: doctor.email, subject: mail.subject, body: mail.body, caseId: c.caseId, approvedAt: now.toISOString() },
      consent: { sharedFields: c.sharedFields }, caseRecord: record, contacts: [],
      allowlist: parseAllowlist(this.deps.env.OUTBOUND_ALLOWLIST ?? ''), now: now.toISOString(), mode: mode(this.deps.env),
      ...(this.deps.env.OUTBOUND_ALLOW_REAL !== undefined ? { outboundAllowReal: this.deps.env.OUTBOUND_ALLOW_REAL } : {}),
    });
    if (!gate.ok) throw new ConsultError(422, 'The review link cannot be sent', [...gate.reasons]);
    // Reserve first (new token replaces any earlier one), then send.
    const reserved = await this.save({
      ...c, status: 'sent_to_doctor', reviewTokenHash: minted.tokenHash, reviewTokenExpiresAt: minted.expiresAt,
      reviewTokenEmail: normalizeAddress(doctor.email), reviewTokenUsedAt: null, sentToDoctorAt: now.toISOString(), failureReasons: [],
    }, c.version);
    try {
      await this.deps.email().send(gate.payload);
    } catch (err) {
      console.error('[consult] review email failed', err instanceof Error ? err.name : 'error');
      await this.deps.store.save(c.caseId, 'consult', c.id, { ...c, version: reserved.version + 1, updatedAt: this.iso(), failureReasons: ['doctor_email_failed'] }, reserved.version);
      throw new ConsultError(502, 'The review email could not be sent; try again');
    }
    return reserved;
  }

  private async consent(c: ConsultRequest): Promise<ConsultRequest> {
    if (c.status !== 'doctor_approved') throw new ConsultError(409, 'You can confirm only after your doctor approves the request');
    return this.save({ ...c, status: 'ready', patientConsentAt: this.iso() }, c.version);
  }

  private async send(c: ConsultRequest): Promise<ConsultRequest> {
    if (c.status !== 'ready') throw new ConsultError(422, 'The request is not ready to send', ['consult_not_ready']);
    const { targetKind, targetId } = targetOf(c.resourceKey);
    const resource = (await this.deps.loadInputs(c.caseId)).find(r => `${r.targetKind}:${r.targetId}` === c.resourceKey);
    const now = this.deps.now();
    const fields = this.approvalFields(c);
    if (!fields || !verifyApprovalMac(c.approvalMac, fields, this.deps.env)) {
      await this.deps.store.save(c.caseId, 'consult', c.id, { ...c, version: c.version + 1, updatedAt: this.iso(), failureReasons: ['approval_not_verified'] }, c.version);
      throw new ConsultError(422, 'The request cannot be sent', ['approval_not_verified']);
    }
    const gate = checkConsultOutbound({
      consult: {
        caseId: c.caseId, targetId, status: c.status, subject: c.subject, body: c.body, sharedFields: c.sharedFields,
        doctorApprovedAt: c.doctorApprovedAt, patientConsentAt: c.patientConsentAt, approvedBodyHash: c.approvedBodyHash,
        expertAddress: c.process.expertAddress, addressEvidenceId: c.process.addressEvidenceId, approver: c.approvedBy,
      },
      evidence: resource?.evidence ?? [],
      caseRecord: await this.recordOf(c.caseId),
      contacts: await this.deps.tracker.contacts(c.caseId),
      allowlist: parseAllowlist(this.deps.env.OUTBOUND_ALLOWLIST ?? ''), now: now.toISOString(), mode: mode(this.deps.env),
      ...(this.deps.env.OUTBOUND_ALLOW_REAL !== undefined ? { outboundAllowReal: this.deps.env.OUTBOUND_ALLOW_REAL } : {}),
    });
    if (!gate.ok) {
      await this.deps.store.save(c.caseId, 'consult', c.id, { ...c, version: c.version + 1, updatedAt: this.iso(), failureReasons: [...gate.reasons] }, c.version);
      throw new ConsultError(422, 'The request cannot be sent', [...gate.reasons]);
    }
    // Reserve before sending; an ambiguous send is never retried automatically.
    const sentAt = now.toISOString();
    const reserved = await this.save({ ...c, status: 'sent', sentAt, failureReasons: [] }, c.version);
    let ref: { messageId?: string; threadId?: string };
    try {
      ref = await this.deps.email().send(gate.payload);
    } catch (err) {
      console.error('[consult] expert email failed', err instanceof Error ? err.name : 'error');
      await this.deps.store.save(c.caseId, 'consult', c.id, { ...reserved, status: 'failed', sentAt: null, version: reserved.version + 1, updatedAt: this.iso(), failureReasons: ['send_failed'] }, reserved.version);
      throw new ConsultError(502, 'The request could not be sent');
    }
    // The consult record and the tracker (contact + outbound message) commit together (security review #7).
    const done: ConsultRequest = { ...reserved, providerMessageId: ref.messageId?.slice(0, 400) ?? null, version: reserved.version + 1, updatedAt: this.iso() };
    try {
      const committed = await this.deps.tracker.recordSent(
        { consult: done, targetKind, targetId, address: gate.payload.address, sentAt, providerMessageId: ref.messageId ?? null, providerThreadId: ref.threadId ?? null },
        { store: this.deps.store, expectedVersion: reserved.version },
      );
      if (committed) return done;
      console.error('[consult] tracker commit lost its version check (email was sent)');
    } catch (err) {
      console.error('[consult] tracker record failed (email was sent)', err instanceof Error ? err.name : 'error');
    }
    return reserved;
  }

  private async cancel(c: ConsultRequest): Promise<ConsultRequest> {
    if (c.status === 'sent' || c.status === 'cancelled') throw new ConsultError(409, 'This request can no longer be cancelled');
    return this.save({ ...c, status: 'cancelled', reviewTokenHash: null, reviewTokenExpiresAt: null, reviewTokenEmail: null }, c.version);
  }

  // ------------------------------------------------------------------ public review (the token is the capability)

  /** sha256 of a signature-valid, unexpired token (no store lookup), for per-token rate limits; null otherwise. */
  signedTokenHash(token: string): string | null {
    return verifyReviewToken(token, this.deps.now(), this.deps.env)?.tokenHash ?? null;
  }

  /** `used`: also return a link that already recorded a decision (so a repeat POST gets 409, never a second decision). */
  private async byToken(token: string, used = false): Promise<ConsultRequest | null> {
    const now = this.deps.now();
    const verified = verifyReviewToken(token, now, this.deps.env);
    if (!verified) return null;
    const c = await this.deps.store.consultByTokenHash(verified.tokenHash);
    if (!c || !sameHash(c.reviewTokenHash, verified.tokenHash)) return null;
    if (!c.reviewTokenExpiresAt || new Date(c.reviewTokenExpiresAt).getTime() <= now.getTime()) return null;
    // Single-use, and bound to the address it was sent to: a doctor whose email no longer matches cannot use it.
    if ((c.reviewTokenUsedAt && !used) || !c.reviewTokenEmail) return null;
    const doctor = await this.deps.store.get(c.caseId, 'doctor', c.doctorId);
    if (!doctor || normalizeAddress(doctor.email) !== c.reviewTokenEmail) return null;
    return c;
  }

  private async view(c: ConsultRequest): Promise<ReviewView> {
    const doctor = await this.deps.store.get(c.caseId, 'doctor', c.doctorId);
    // The frozen snapshot that is in the message body, never the live packet (security review #8).
    const packet: ReviewView['packet'] = c.packetId && c.packetSnapshot ? structuredClone(c.packetSnapshot) : null;
    return {
      expertName: c.expertName, processKind: c.process.kind, processDetail: c.process.detail, processSourceUrl: c.process.sourceUrl,
      doctorName: doctor?.name ?? 'Referring physician', doctorVerified: c.approvedBy?.verified ?? doctor?.verified ?? false,
      expertAddress: c.process.expertAddress ? normalizeAddress(c.process.expertAddress) : null,
      subject: c.subject, body: c.body, packet, status: c.status,
      expiresAt: c.reviewTokenExpiresAt ?? this.iso(),
    };
  }

  /** null = generic not found (unknown, forged, expired, cancelled or already decided). */
  async reviewView(token: string): Promise<ReviewView | null> {
    const c = await this.byToken(token);
    return c && c.status === 'sent_to_doctor' ? this.view(c) : null;
  }

  /** Everything the approval MAC covers; null when the consult has no complete approval. */
  private approvalFields(c: ConsultRequest): ApprovalFields | null {
    if (!c.doctorApprovedAt || !c.approvedBodyHash || !c.approvedBy) return null;
    return {
      consultId: c.id, caseId: c.caseId, reviewTokenHash: c.reviewTokenHash, doctorApprovedAt: c.doctorApprovedAt,
      to: c.process.expertAddress ? normalizeAddress(c.process.expertAddress) : null, subject: c.subject, body: c.body,
      approvedBodyHash: c.approvedBodyHash, approvedBy: c.approvedBy, doctorApprovalAudit: c.doctorApprovalAudit,
    };
  }

  async reviewDecide(token: string, decision: ReviewDecisionBody, audit: ReviewAudit = { ip: 'unknown', userAgent: '' }): Promise<{ review: ReviewView; footerAdded: boolean }> {
    const c = await this.byToken(token, true);
    if (!c || c.status === 'cancelled') throw new ConsultError(404, 'Not found');
    if (c.status !== 'sent_to_doctor' || c.reviewTokenUsedAt) throw new ConsultError(409, 'A decision was already recorded for this request');
    const now = this.iso();
    const note = decision.note?.trim() || null;
    if (decision.decision === 'decline') {
      const saved = await this.save({ ...c, status: 'doctor_declined', doctorDeclinedAt: now, doctorNote: note, reviewTokenUsedAt: now }, c.version);
      return { review: await this.view(saved), footerAdded: false };
    }
    const doctor = await this.doctorOf(c);
    const subject = decision.subject.trim();
    if (SUBJECT_CONTROL.test(subject) || BODY_CONTROL.test(decision.body)) throw new ConsultError(400, 'The subject cannot contain line breaks, and the message cannot contain control characters', ['control_characters']);
    if (await this.emailRefused(c.caseId, doctor.email)) throw new ConsultError(422, 'This review link can no longer be used', ['doctor_email_not_allowed']);
    const { body, added } = ensureFooter(decision.body, doctor);
    if (body.length > 8000) throw new ConsultError(400, 'The message is too long');
    // Doctors may write clinical content to another clinician, but not patient details the patient did not share.
    if (containsUnsharedField(`${subject}\n${body}`, await this.recordOf(c.caseId), c.sharedFields)) {
      throw new ConsultError(422, 'The message includes patient details the patient did not choose to share', ['unshared_field']);
    }
    const to = c.process.expertAddress ? normalizeAddress(c.process.expertAddress) : null;
    const approved: ConsultRequest = {
      ...c, subject, body, status: 'doctor_approved', reviewTokenUsedAt: now, doctorEdited: subject !== c.subject || body !== c.body,
      doctorApprovedAt: now, doctorNote: note, approvedBodyHash: consultTextHash({ to, subject, body }),
      approvedBy: { email: doctor.email, npi: doctor.npi, verified: doctor.verified }, doctorApprovalAudit: auditHash(audit),
    };
    const saved = await this.save({ ...approved, approvalMac: approvalMac(this.approvalFields(approved)!, this.deps.env) }, c.version);
    return { review: await this.view(saved), footerAdded: added };
  }
}
