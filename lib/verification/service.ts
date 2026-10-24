/**
 * Verification calls. create() writes an 'awaiting_approval' request with the exact script and sends NOTHING.
 * approve() sets approvedAt (compare-and-set), runs checkOutbound, and only a GatedDraft reaches the voice channel.
 * ingest() turns the (untrusted) transcript into a VerificationResult + evidence rows; the transcript never becomes
 * instructions.
 *
 * Contact cap (strict): a verification call is outbound contact with a third party. The gate's contact list is the
 * case's outreach contacts plus one synthetic active contact per other resource already called for verification, and
 * a call to a resource not yet among the active ones is refused once MAX_ACTIVE_CONTACTS resources are active.
 */
import { randomUUID } from 'node:crypto';
import { parseAllowlist } from '../safety/allowlist';
import { activeTargetIds, MAX_ACTIVE_CONTACTS } from '../safety/caps';
import { checkOutbound } from '../safety/outbound-gate';
import type { CaseRecord, SafetyContact } from '../safety/types';
import type { GatedDraft } from '../safety/outbound-gate';
import type { PlanEvidence, PlanTargetKind } from '../plan/contract';
import { parsePlanContactPoints, type PlanContactPoint } from '../plan/contact-points';
import { best, ruleFamily } from '../plan/rules';
import { badgesFor } from './badges';
import { verificationRequestSchema, type VerificationBadge, type VerificationRequest, type VerifyCreateBody } from './contract';
import { resultToEvidence } from './evidence';
import { createVerifyScript, sharedValues, type VerifySharedField } from './script';
import type { VerificationStore } from './store';
import { parseVerificationTranscript, type VerificationExtractor } from './transcript';

export class VerificationError extends Error {
  constructor(public status: number, public code: string, public reasons: string[] = []) { super(code); this.name = 'VerificationError'; }
}

export interface VerificationResource {
  name: string;
  targetKind: PlanTargetKind;
  targetId: string;
  subKind?: string | null;
  evidence: PlanEvidence[];
}

export interface VerificationServiceDeps {
  store: VerificationStore;
  loadResource(caseId: string, resourceKey: string): Promise<VerificationResource | null>;
  /** The FULL case record: the gate scans the script against every field, shared or not. */
  caseRecord(caseId: string): Promise<CaseRecord | null>;
  /** The case's outreach contacts (for the active-contact cap and follow-up cadence). */
  contacts(caseId: string): Promise<SafetyContact[]>;
  /** Voice channel (AgentCall or mock caller); only ever receives a GatedDraft. */
  voice: { readonly kind: string; send(gated: GatedDraft): Promise<{ callId?: string }> };
  env?: Record<string, string | undefined>;
  clock?: () => Date;
  appBaseUrl?: string;
  /** Optional LLM extraction; wiring passes it only when a gateway is configured and not offline. */
  extractor?: VerificationExtractor;
  /** Offline/demo only: a synthetic transcript for a call just placed on the mock caller. */
  simulate?(request: VerificationRequest): unknown;
}

const FAILED_CALL_STATUSES = new Set(['failed', 'no-answer', 'no_answer', 'busy', 'canceled', 'cancelled', 'voicemail', 'error']);

export class VerificationService {
  private readonly env: Record<string, string | undefined>;
  private readonly clock: () => Date;
  constructor(private readonly deps: VerificationServiceDeps) {
    this.env = deps.env ?? process.env;
    this.clock = deps.clock ?? (() => new Date());
  }

  async list(caseId: string): Promise<{ requests: VerificationRequest[]; badges: Record<string, VerificationBadge[]> }> {
    if (!(await this.deps.caseRecord(caseId))) throw new VerificationError(404, 'case_not_found');
    const requests = await this.deps.store.list(caseId);
    return { requests, badges: badgesFor(requests) };
  }

  /** Best code-stamped voice contact point (plan origin preference for the resource's family). */
  pickPhone(resource: VerificationResource): PlanContactPoint | undefined {
    return best(parsePlanContactPoints(resource.evidence), 'voice', ruleFamily(resource));
  }

  async create(caseId: string, body: VerifyCreateBody): Promise<{ request: VerificationRequest; created: boolean }> {
    const resource = await this.deps.loadResource(caseId, body.resourceKey);
    if (!resource || `${resource.targetKind}:${resource.targetId}` !== body.resourceKey) throw new VerificationError(404, 'resource_not_found');
    const record = await this.deps.caseRecord(caseId);
    if (!record) throw new VerificationError(404, 'case_not_found');
    const phone = this.pickPhone(resource);
    if (!phone) throw new VerificationError(422, 'no_phone');
    const sharedFields = [...body.sharedFields] as VerifySharedField[];
    const open = (await this.deps.store.list(caseId)).filter(r => r.resourceKey === body.resourceKey);
    if (open.some(r => r.status === 'calling')) throw new VerificationError(409, 'already_calling');
    const pending = open.find(r => r.status === 'awaiting_approval' && r.phone === phone.address
      && [...r.sharedFields].sort().join() === [...sharedFields].sort().join());
    if (pending) return { request: pending, created: false };
    let script: string;
    try { script = createVerifyScript({ name: resource.name, record, sharedFields }); } catch { throw new VerificationError(422, 'diagnosis_missing'); }
    const request = verificationRequestSchema.parse({
      id: randomUUID(), caseId, resourceKey: body.resourceKey, targetKind: resource.targetKind, targetId: resource.targetId,
      name: resource.name.trim().slice(0, 200) || resource.targetId, phone: phone.address, phoneEvidenceId: phone.evidenceId,
      sharedFields, script, status: 'awaiting_approval', createdAt: this.clock().toISOString(), approvedAt: null, callId: null,
      result: null, evidenceIds: [], blockedReasons: [],
    });
    return { request: await this.deps.store.create(request), created: true };
  }

  private async block(request: VerificationRequest, reasons: string[]): Promise<never> {
    await this.deps.store.update(request.id, 'awaiting_approval', { status: 'blocked', blockedReasons: reasons });
    throw new VerificationError(422, 'gate_refused', reasons);
  }

  /** Gate contact list: outreach contacts + one active synthetic contact per other resource called for verification. */
  private async gateContacts(request: VerificationRequest): Promise<SafetyContact[]> {
    const contacts = await this.deps.contacts(request.caseId);
    const known = new Set(contacts.map(c => c.targetId).filter(Boolean));
    const others = (await this.deps.store.list(request.caseId))
      .filter(r => r.id !== request.id && (r.status === 'calling' || r.status === 'completed') && !known.has(r.targetId));
    const synthetic = [...new Map(others.map(r => [r.targetId, r])).values()]
      .map((r): SafetyContact => ({ id: `verification:${r.id}`, caseId: r.caseId, targetId: r.targetId, state: 'sent' }));
    return [...contacts, ...synthetic];
  }

  async approve(caseId: string, id: string): Promise<VerificationRequest> {
    const existing = await this.deps.store.get(caseId, id);
    if (!existing) throw new VerificationError(404, 'verification_not_found');
    if (existing.approvedAt || existing.status !== 'awaiting_approval') throw new VerificationError(409, 'already_approved');
    const now = this.clock().toISOString();
    const request = await this.deps.store.approve(caseId, id, now);
    if (!request) throw new VerificationError(409, 'already_approved');

    const record = await this.deps.caseRecord(caseId);
    if (!record) return this.block(request, ['case_not_found']);
    // The phone must still be a code-stamped voice contact point of this resource.
    const resource = await this.deps.loadResource(caseId, request.resourceKey);
    const stillVerified = !!resource && parsePlanContactPoints(resource.evidence)
      .some(cp => cp.channel === 'voice' && cp.evidenceId === request.phoneEvidenceId && cp.address === request.phone);
    if (!stillVerified) return this.block(request, ['phone_not_verified']);

    const contacts = await this.gateContacts(request);
    const gate = checkOutbound({
      draft: { channel: 'voice', address: request.phone, body: request.script, caseId, approvedAt: now },
      caseRecord: record,
      consent: { sharedFields: [...request.sharedFields], approvedAt: now },
      contacts,
      allowlist: parseAllowlist(this.env.OUTBOUND_ALLOWLIST ?? ''),
      now,
      mode: this.env.NODE_ENV === 'production' ? 'prod' : 'dev',
    });
    const reasons: string[] = gate.ok ? [] : [...gate.reasons];
    const active = activeTargetIds(contacts);
    if (!active.has(`t:${request.targetId}`) && active.size >= MAX_ACTIVE_CONTACTS && !reasons.includes('contact_cap')) reasons.push('contact_cap');
    if (!gate.ok || reasons.length) return this.block(request, reasons);
    if (this.deps.voice.kind !== 'voice') return this.block(request, ['channel_unavailable']);

    // Reserve before dialing; an ambiguous send is never retried automatically.
    const calling = await this.deps.store.update(request.id, 'awaiting_approval', { status: 'calling' });
    if (!calling) throw new VerificationError(409, 'already_approved');
    let callId: string | undefined;
    try {
      callId = (await this.deps.voice.send(gate.payload)).callId;
    } catch {
      callId = undefined;
    }
    if (!callId) {
      await this.deps.store.update(request.id, 'calling', { status: 'failed', blockedReasons: ['call_failed'] });
      throw new VerificationError(502, 'call_failed');
    }
    const placed = await this.deps.store.update(request.id, 'calling', { callId });
    if (!placed) throw new VerificationError(409, 'call_state_changed');
    if (this.deps.simulate) {
      const transcript = this.deps.simulate(placed);
      if (transcript !== undefined) return (await this.ingest(callId, transcript)) ?? placed;
    }
    return placed;
  }

  /** Completed call -> result + evidence. Returns null when the call is not a verification call. Idempotent. */
  async ingest(callId: string, rawTranscript: unknown, calledAt?: string): Promise<VerificationRequest | null> {
    const request = await this.deps.store.byCallId(callId);
    if (!request) return null;
    if (request.status !== 'calling') return request;
    const record = await this.deps.caseRecord(request.caseId);
    let ctx: { diseaseName: string | null; insurer: string | null } = { diseaseName: null, insurer: null };
    try { if (record) ctx = sharedValues(record, request.sharedFields as VerifySharedField[]); } catch { /* keep nulls */ }
    const at = calledAt && !Number.isNaN(Date.parse(calledAt)) ? new Date(calledAt).toISOString() : this.clock().toISOString();
    const { result } = await parseVerificationTranscript(rawTranscript, {
      requestId: request.id, callId, calledAt: at, diseaseName: ctx.diseaseName, insurer: ctx.insurer,
      insuranceShared: request.sharedFields.includes('insurer') && !!ctx.insurer,
      ...(this.deps.extractor ? { extractor: this.deps.extractor } : {}),
    });
    const rows = resultToEvidence(request, result, this.appBaseUrl());
    if (rows.length && this.deps.store.saveEvidence) {
      try { await this.deps.store.saveEvidence(request, rows); } catch (err) {
        console.error('[verification] evidence write failed', err instanceof Error ? err.name : 'unknown');
      }
    }
    const done = await this.deps.store.update(request.id, 'calling', {
      status: rows.length ? 'completed' : 'failed', result, evidenceIds: rows.map(r => r.id),
      ...(rows.length ? {} : { blockedReasons: ['no_answers'] }),
    });
    return done ?? this.deps.store.byCallId(callId);
  }

  /** A provider call.status that ends the call without a transcript marks the request failed. */
  async callStatus(callId: string, status: string | undefined): Promise<VerificationRequest | null> {
    const request = await this.deps.store.byCallId(callId);
    if (!request) return null;
    if (request.status !== 'calling' || !status || !FAILED_CALL_STATUSES.has(status.toLowerCase())) return request;
    return (await this.deps.store.update(request.id, 'calling', { status: 'failed', blockedReasons: ['call_not_completed'] })) ?? request;
  }

  private appBaseUrl(): string {
    return this.deps.appBaseUrl ?? this.env.WAYFINDER_APP_BASE_URL ?? this.env.WAYFINDER_APP_ORIGIN ?? 'http://localhost:3000';
  }
}
