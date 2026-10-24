import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MockCaller } from '@/lib/channels/mock-caller';
import { evidenceSchema } from '@/lib/contracts/evidence';
import { AI_DISCLOSURE_VOICE } from '@/lib/safety/disclosure';
import type { SafetyContact } from '@/lib/safety/types';
import { badgesFor } from '@/lib/verification/badges';
import { verificationRequestSchema, type VerificationRequest } from '@/lib/verification/contract';
import { callRecordUrl, resultToEvidence } from '@/lib/verification/evidence';
import { syntheticVerificationTranscript } from '@/lib/verification/mock-transcript';
import { STALE_CALLING_MS, VerificationError, VerificationService, type VerificationResource } from '@/lib/verification/service';
import { MemoryVerificationStore } from '@/lib/verification/store';
import { phoneEvidence, PHONE, RECORD } from './fixtures';

const CASE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const KEY = `expert:${TARGET}`;
const NOW = new Date('2026-10-24T15:00:00.000Z');

function setup(over: { evidence?: VerificationResource['evidence']; contacts?: SafetyContact[]; allowlist?: string; simulate?: boolean; clock?: () => Date; extra?: VerificationResource[] } = {}) {
  const store = new MemoryVerificationStore();
  const voice = new MockCaller({ allowlist: [PHONE] }, () => NOW);
  const send = vi.spyOn(voice, 'send');
  const resource: VerificationResource = { name: 'Example Sarcoma Center', targetKind: 'expert', targetId: TARGET, evidence: over.evidence ?? [phoneEvidence()] };
  const service = new VerificationService({
    store,
    loadResource: async (_c, key) => (key === KEY ? resource : over.extra?.find(r => `${r.targetKind}:${r.targetId}` === key) ?? null),
    caseRecord: async id => (id === CASE ? RECORD : null),
    contacts: async () => over.contacts ?? [],
    voice,
    env: { OUTBOUND_ALLOWLIST: over.allowlist ?? PHONE, NODE_ENV: 'test' },
    clock: over.clock ?? (() => NOW),
    appBaseUrl: 'https://app.example.org',
    ...(over.simulate ? { simulate: (r: VerificationRequest) => syntheticVerificationTranscript(r) } : {}),
  });
  return { store, voice, send, service };
}

const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof VerificationError ? { status: e.status, code: e.code, reasons: e.reasons } : e; } };

describe('VerificationService.create', () => {
  it('writes an awaiting_approval request with the script preview and sends NOTHING', async () => {
    const { service, send, store } = setup();
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    expect(verificationRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ status: 'awaiting_approval', approvedAt: null, callId: null, phone: PHONE, phoneEvidenceId: phoneEvidence().id });
    expect(request.script.startsWith(AI_DISCLOSURE_VOICE)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(await store.list(CASE)).toHaveLength(1);
    // Same request again is idempotent.
    expect((await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] })).created).toBe(false);
  });

  it('only ticked fields reach the script', async () => {
    const { service } = setup();
    const plain = (await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] })).request;
    expect(plain.script).not.toContain('Fictional Health Plan');
    for (const v of ['hepatic primary', 'multifocal lesions', 'Springfield', 'Vermont', 'FHP-0042']) expect(plain.script).not.toContain(v);
    const withInsurer = (await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName', 'insurer'] })).request;
    expect(withInsurer.script).toContain('Fictional Health Plan');
  });

  it('no code-stamped phone -> 422 no_phone (a phone in a free-text claim is never used)', async () => {
    const { service } = setup({ evidence: [{ id: 'x', claimType: 'intake_note', claim: 'Call +16175550111 to book', sourceUrl: 'https://center.example.org', sourceKind: 'exa' }] });
    expect(await code(service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] }))).toMatchObject({ status: 422, code: 'no_phone' });
  });

  it('unknown resource -> 404', async () => {
    const { service } = setup();
    expect(await code(service.create(CASE, { resourceKey: 'expert:nope', sharedFields: ['diseaseName'] }))).toMatchObject({ status: 404 });
  });
});

describe('VerificationService.approve', () => {
  it('approves once, passes the gate and places the call with the exact script; a second approve is 409', async () => {
    const { service, send, voice } = setup();
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    const placed = await service.approve(CASE, request.id);
    expect(placed).toMatchObject({ status: 'calling', approvedAt: NOW.toISOString() });
    expect(placed.callId).toMatch(/^mock-call-/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(voice.calls[0]).toMatchObject({ to: PHONE, script: request.script, caseId: CASE });
    expect(await code(service.approve(CASE, request.id))).toMatchObject({ status: 409, code: 'already_approved' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a gate refusal -> status blocked with reason codes, nothing dialed', async () => {
    const { service, send, store } = setup({ allowlist: '' });
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    expect(await code(service.approve(CASE, request.id))).toMatchObject({ status: 422, reasons: ['not_allowlisted'] });
    expect(send).not.toHaveBeenCalled();
    expect(await store.get(CASE, request.id)).toMatchObject({ status: 'blocked', blockedReasons: ['not_allowlisted'] });
  });

  it('the active-contact cap counts verification calls to resources without a contact (strict)', async () => {
    const contacts: SafetyContact[] = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, caseId: CASE, targetId: `other-${i}`, address: `+1617555020${i}`, state: 'sent' }));
    const { service, send } = setup({ contacts });
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    expect(await code(service.approve(CASE, request.id))).toMatchObject({ status: 422, reasons: expect.arrayContaining(['contact_cap']) });
    expect(send).not.toHaveBeenCalled();
  });

  it('a script edited in the store after preview is refused by the gate (unshared field)', async () => {
    const { service, store, send } = setup();
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    const rows = (store as unknown as { rows: Map<string, VerificationRequest> }).rows;
    rows.set(request.id, { ...rows.get(request.id)!, script: `${request.script}\nThe patient lives in Springfield.` });
    expect(await code(service.approve(CASE, request.id))).toMatchObject({ status: 422, reasons: ['unshared_field'] });
    expect(send).not.toHaveBeenCalled();
  });

  it('a phone that is no longer a code-stamped contact point is blocked', async () => {
    const evidence = [phoneEvidence()];
    const { service, send } = setup({ evidence });
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    evidence.length = 0;
    expect(await code(service.approve(CASE, request.id))).toMatchObject({ status: 422, reasons: ['phone_not_verified'] });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('VerificationService.ingest -> evidence and badges', () => {
  it('completes with evidence rows (verification.<key>, phone_call) and badges; duplicates are idempotent', async () => {
    const { service, store } = setup();
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    const placed = await service.approve(CASE, request.id);
    const done = await service.ingest(placed.callId!, [
      { role: 'ai', text: AI_DISCLOSURE_VOICE },
      { role: 'ai', text: 'Are you currently accepting new adult patients?' },
      { role: 'human', text: 'Yes, we are.' },
      { role: 'ai', text: 'Is a referral from another doctor needed for a first appointment?' },
      { role: 'human', text: 'Yes, a referral is needed.' },
      { role: 'ai', text: 'Do you offer consultations or second opinions?' },
      { role: 'human', text: "No, we don't offer second opinions." },
    ], '2026-10-24T16:00:00.000Z');
    expect(done).toMatchObject({ status: 'completed' });
    expect(done!.evidenceIds).toHaveLength(3);
    for (const row of store.evidence) {
      expect(evidenceSchema.safeParse(row).success).toBe(true);
      expect(row).toMatchObject({ sourceKind: 'phone_call', sourceUrl: `https://app.example.org/cases/${CASE}/threads?call=${placed.callId}` });
    }
    expect(store.evidence.map(e => e.claimType)).toEqual(['verification.new_adult_patients', 'verification.referral_required', 'verification.consultations']);
    expect(store.evidence[0].claim).toBe('Verified by phone on 2026-10-24: "Yes, we are." — accepts new adult patients.');
    const { badges } = await service.list(CASE);
    expect(badges[KEY].map(b => b.label)).toEqual([
      'Verified by phone on Oct 24, 2026: accepts new adult patients',
      'Verified by phone on Oct 24, 2026: referral needed',
      'Verified by phone on Oct 24, 2026: does not offer second opinions',
    ]);
    expect(await service.ingest(placed.callId!, [])).toMatchObject({ status: 'completed' });
    expect(store.evidence).toHaveLength(3);
    expect(await service.ingest('unknown-call', [])).toBeNull();
  });

  it('an empty transcript or one without answers -> failed, no evidence, no badges', async () => {
    const { service, store } = setup();
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    const placed = await service.approve(CASE, request.id);
    expect(await service.ingest(placed.callId!, [])).toMatchObject({ status: 'failed', evidenceIds: [] });
    expect(store.evidence).toHaveLength(0);
    expect((await service.list(CASE)).badges).toEqual({});
  });

  it('offline: the mock caller completes with a synthetic transcript right after approval', async () => {
    const { service } = setup({ simulate: true });
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    const done = await service.approve(CASE, request.id);
    expect(done.status).toBe('completed');
    expect(done.result?.answers.find(a => a.key === 'insurance')?.value).toBe('not_asked');
    expect(done.evidenceIds).toHaveLength(5);
  });

  it('a failed call status marks the request failed', async () => {
    const { service } = setup();
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    const placed = await service.approve(CASE, request.id);
    expect(await service.callStatus(placed.callId!, 'in-progress')).toMatchObject({ status: 'calling' });
    expect(await service.callStatus(placed.callId!, 'no-answer')).toMatchObject({ status: 'failed' });
  });
});

describe('badgesFor / resultToEvidence', () => {
  const req = (id: string, calledAt: string, value: 'yes' | 'no'): VerificationRequest => {
    const result = {
      requestId: id, callId: `call-${id}`, calledAt, parser: 'deterministic' as const,
      answers: (['treats_condition', 'new_adult_patients', 'referral_required', 'consultations', 'how_to_start', 'insurance'] as const).map(key => (
        key === 'new_adult_patients' ? { key, value, detail: null, quote: value === 'yes' ? 'Yes.' : 'No.', turnIndex: 1 } : { key, value: 'unclear' as const, detail: null, quote: null, turnIndex: null })),
    };
    const evidenceIds = resultToEvidence({ id, caseId: CASE }, result, 'https://app.example.org').map(e => e.id);
    return verificationRequestSchema.parse({
      id, caseId: CASE, resourceKey: KEY, targetKind: 'expert', targetId: TARGET, name: 'X', phone: PHONE, phoneEvidenceId: 'p', sharedFields: ['diseaseName'],
      script: AI_DISCLOSURE_VOICE, status: 'completed', createdAt: calledAt, approvedAt: calledAt, callId: `call-${id}`, result, evidenceIds, blockedReasons: [],
    });
  };

  it('latest completed call wins per key', () => {
    const badges = badgesFor([req('a', '2026-10-20T10:00:00.000Z', 'yes'), req('b', '2026-10-23T10:00:00.000Z', 'no')]);
    expect(badges[KEY]).toHaveLength(1);
    expect(badges[KEY][0]).toMatchObject({ value: 'no', label: 'Verified by phone on Oct 23, 2026: not accepting new adult patients' });
  });

  it('only yes/no answers become evidence; non-https bases are refused', () => {
    expect(req('a', '2026-10-20T10:00:00.000Z', 'yes').evidenceIds).toHaveLength(1);
    expect(() => callRecordUrl('http://app.example.org', CASE, 'c')).toThrow();
    expect(callRecordUrl('http://localhost:3000/', CASE, 'c 1')).toBe(`http://localhost:3000/cases/${CASE}/threads?call=c+1`);
  });
});

describe('safety review: stale calls, pending call ids and an atomic contact cap', () => {
  const OTHER = '33333333-3333-4333-8333-333333333333';
  const MIN = 60_000;
  const stuck = async (store: MemoryVerificationStore, template: VerificationRequest, approvedAt: Date, targetId = OTHER) =>
    store.create({ ...template, id: randomUUID(), targetId, resourceKey: `expert:${targetId}`, status: 'calling', approvedAt: approvedAt.toISOString(), callId: null });

  it('a calling request older than the timeout is failed on list/create and no longer blocks re-verification', async () => {
    let now = NOW;
    const { service, store } = setup({ clock: () => now });
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    await store.update(request.id, 'awaiting_approval', { status: 'calling' });
    expect(await code(service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] }))).toMatchObject({ status: 409, code: 'already_calling' });
    now = new Date(NOW.getTime() + STALE_CALLING_MS + MIN);
    expect((await service.list(CASE)).requests.find(r => r.id === request.id)).toMatchObject({ status: 'failed', blockedReasons: ['call_timeout'] });
    expect((await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] })).created).toBe(true);
  });

  it('a stale calling request no longer counts toward the contact cap', async () => {
    const contacts: SafetyContact[] = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, caseId: CASE, targetId: `other-${i}`, address: `+1617555020${i}`, state: 'sent' }));
    const { service, store, send } = setup({ contacts });
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    await stuck(store, request, new Date(NOW.getTime() - STALE_CALLING_MS - MIN));
    expect(await service.approve(CASE, request.id)).toMatchObject({ status: 'calling' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('hasPendingCall is true only for a recent calling request whose call id is not saved yet', async () => {
    const { service, store } = setup();
    const { request } = await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] });
    expect(await service.hasPendingCall()).toBe(false);
    await stuck(store, request, new Date(NOW.getTime() - STALE_CALLING_MS - MIN));
    expect(await service.hasPendingCall()).toBe(false);
    await stuck(store, request, new Date(NOW.getTime() - MIN), '44444444-4444-4444-8444-444444444444');
    expect(await service.hasPendingCall()).toBe(true);
  });

  it('two concurrent approvals at cap-1 for different resources place exactly one call', async () => {
    const contacts: SafetyContact[] = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, caseId: CASE, targetId: `other-${i}`, address: `+1617555020${i}`, state: 'sent' }));
    const extra: VerificationResource = { name: 'Other Center', targetKind: 'expert', targetId: OTHER, evidence: [phoneEvidence()] };
    const { service, send, store } = setup({ contacts, extra: [extra] });
    const a = (await service.create(CASE, { resourceKey: KEY, sharedFields: ['diseaseName'] })).request;
    const b = (await service.create(CASE, { resourceKey: `expert:${OTHER}`, sharedFields: ['diseaseName'] })).request;
    const results = await Promise.all([code(service.approve(CASE, a.id)), code(service.approve(CASE, b.id))]);
    expect(results.filter(r => r === null)).toHaveLength(1);
    expect(results.find(r => r !== null)).toMatchObject({ status: 422, reasons: ['contact_cap'] });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await store.list(CASE)).map(r => r.status).sort()).toEqual(['blocked', 'calling']);
  });
});
