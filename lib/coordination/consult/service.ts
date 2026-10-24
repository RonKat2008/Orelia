import { parseAllowlist } from '@/lib/safety/allowlist';
import { checkConsultOutbound, consultTextHash } from '@/lib/safety/consult-gate';
import { containsUnsharedField } from '@/lib/safety/minimize';
import { checkOutbound, type GatedDraft } from '@/lib/safety/outbound-gate';
import type { CaseRecord } from '@/lib/safety/types';
import type { PlanResourceInput } from '@/lib/plan/contract';
import {
  consultRequestSchema, doctorSchema,
  type ConsultRequest, type CoordinationStore, type Doctor, type ReviewDecisionBody, type ReviewView, type TargetKind,
} from '../contract';
import { includedSections, renderPacketText } from '../packet/render';
import type { ExaSearcher } from '../requirements/deps';
import { buildConsultDraft, doctorReviewEmail, draftProblems, ensureFooter, FIELD_LABELS } from './draft';
import { discoverConsultProcess } from './process';
import { appBaseUrl, mintReviewToken, reviewUrl, sameHash, verifyReviewToken } from './token';
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
}

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

export interface NewConsultInput { resourceKey: string; doctorId: string; packetId?: string | null; sharedFields: string[] }
export interface ConsultPatch { version: number; action: 'edit' | 'send_to_doctor' | 'consent' | 'send' | 'cancel'; subject?: string; body?: string }

export class ConsultService {
  constructor(private readonly deps: ConsultDeps) {}

  private iso() { return this.deps.now().toISOString(); }

  // ------------------------------------------------------------------ doctors

  async listDoctors(caseId: string): Promise<Doctor[]> {
    return (await this.deps.store.list(caseId, 'doctor')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addDoctor(caseId: string, body: { name: string; practice?: string; email: string }): Promise<Doctor> {
    const doctor = doctorSchema.parse({ id: crypto.randomUUID(), caseId, name: body.name, practice: body.practice?.trim() || null, email: body.email.trim().toLowerCase(), createdAt: this.iso() });
    const saved = await this.deps.store.save(caseId, 'doctor', doctor.id, doctor);
    if (!saved) throw new ConsultError(500, 'Unable to save the doctor');
    return saved;
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
    if (input.packetId) {
      const packet = await store.get(caseId, 'packet', input.resourceKey);
      if (!packet || packet.id !== input.packetId) throw new ConsultError(404, 'Packet not found');
      packetText = includedSections(packet).length ? renderPacketText(packet) : null;
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
      reviewTokenHash: null, reviewTokenExpiresAt: null, sentToDoctorAt: null, doctorEdited: false, doctorApprovedAt: null, doctorDeclinedAt: null,
      doctorNote: null, approvedBodyHash: null, patientConsentAt: null, sentAt: null, providerMessageId: null, failureReasons: [],
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
    const record = await this.recordOf(c.caseId);
    const now = this.deps.now();
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
      ...c, status: 'sent_to_doctor', reviewTokenHash: minted.tokenHash, reviewTokenExpiresAt: minted.expiresAt, sentToDoctorAt: now.toISOString(), failureReasons: [],
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
    const gate = checkConsultOutbound({
      consult: {
        caseId: c.caseId, targetId, status: c.status, subject: c.subject, body: c.body, sharedFields: c.sharedFields,
        doctorApprovedAt: c.doctorApprovedAt, patientConsentAt: c.patientConsentAt, approvedBodyHash: c.approvedBodyHash,
        expertAddress: c.process.expertAddress, addressEvidenceId: c.process.addressEvidenceId,
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
    const done = await this.save({ ...reserved, providerMessageId: ref.messageId?.slice(0, 400) ?? null }, reserved.version);
    try {
      await this.deps.tracker.recordSent({ consult: done, targetKind, targetId, address: gate.payload.address, sentAt, providerMessageId: ref.messageId ?? null, providerThreadId: ref.threadId ?? null });
    } catch (err) {
      console.error('[consult] tracker record failed (email was sent)', err instanceof Error ? err.name : 'error');
    }
    return done;
  }

  private async cancel(c: ConsultRequest): Promise<ConsultRequest> {
    if (c.status === 'sent' || c.status === 'cancelled') throw new ConsultError(409, 'This request can no longer be cancelled');
    return this.save({ ...c, status: 'cancelled', reviewTokenHash: null, reviewTokenExpiresAt: null }, c.version);
  }

  // ------------------------------------------------------------------ public review (the token is the capability)

  private async byToken(token: string): Promise<ConsultRequest | null> {
    const now = this.deps.now();
    const verified = verifyReviewToken(token, now, this.deps.env);
    if (!verified) return null;
    const c = await this.deps.store.consultByTokenHash(verified.tokenHash);
    if (!c || !sameHash(c.reviewTokenHash, verified.tokenHash)) return null;
    if (!c.reviewTokenExpiresAt || new Date(c.reviewTokenExpiresAt).getTime() <= now.getTime()) return null;
    return c;
  }

  private async view(c: ConsultRequest): Promise<ReviewView> {
    const doctor = await this.deps.store.get(c.caseId, 'doctor', c.doctorId);
    let packet: ReviewView['packet'] = null;
    if (c.packetId) {
      const p = await this.deps.store.get(c.caseId, 'packet', c.resourceKey);
      packet = p && p.id === c.packetId ? includedSections(p) : null;
    }
    return {
      expertName: c.expertName, processKind: c.process.kind, processDetail: c.process.detail, processSourceUrl: c.process.sourceUrl,
      doctorName: doctor?.name ?? 'Referring physician', subject: c.subject, body: c.body, packet, status: c.status,
      expiresAt: c.reviewTokenExpiresAt ?? this.iso(),
    };
  }

  /** null = generic not found (unknown, forged, expired, cancelled or already decided). */
  async reviewView(token: string): Promise<ReviewView | null> {
    const c = await this.byToken(token);
    return c && c.status === 'sent_to_doctor' ? this.view(c) : null;
  }

  async reviewDecide(token: string, decision: ReviewDecisionBody): Promise<{ review: ReviewView; footerAdded: boolean }> {
    const c = await this.byToken(token);
    if (!c || c.status === 'cancelled') throw new ConsultError(404, 'Not found');
    if (c.status !== 'sent_to_doctor') throw new ConsultError(409, 'A decision was already recorded for this request');
    const now = this.iso();
    const note = decision.note?.trim() || null;
    if (decision.decision === 'decline') {
      const saved = await this.save({ ...c, status: 'doctor_declined', doctorDeclinedAt: now, doctorNote: note }, c.version);
      return { review: await this.view(saved), footerAdded: false };
    }
    const doctor = await this.doctorOf(c);
    const subject = decision.subject.trim();
    const { body, added } = ensureFooter(decision.body, doctor);
    if (body.length > 8000) throw new ConsultError(400, 'The message is too long');
    // Doctors may write clinical content to another clinician, but not patient details the patient did not share.
    if (containsUnsharedField(`${subject}\n${body}`, await this.recordOf(c.caseId), c.sharedFields)) {
      throw new ConsultError(422, 'The message includes patient details the patient did not choose to share', ['unshared_field']);
    }
    const saved = await this.save({
      ...c, subject, body, status: 'doctor_approved', doctorEdited: subject !== c.subject || body !== c.body,
      doctorApprovedAt: now, doctorNote: note, approvedBodyHash: consultTextHash(subject, body),
    }, c.version);
    return { review: await this.view(saved), footerAdded: added };
  }
}
