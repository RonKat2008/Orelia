import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const holderSvc = vi.hoisted(() => ({ service: undefined as unknown }));
vi.mock('@/lib/verification/server', () => ({ getVerificationService: async () => holderSvc.service }));

import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MockCaller } from '@/lib/channels/mock-caller';
import { verificationsResponseSchema } from '@/lib/verification/contract';
import { VerificationService } from '@/lib/verification/service';
import { MemoryVerificationStore } from '@/lib/verification/store';
import { GET, POST } from '@/app/api/cases/[id]/verifications/route';
import { POST as APPROVE } from '@/app/api/cases/[id]/verifications/[vid]/approve/route';
import { phoneEvidence, PHONE, RECORD } from './fixtures';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const KEY = `expert:${TARGET}`;
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};
const cookie = (who: string) => `wf_session=${signSession(who, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const req = (path: string, o: { method?: string; who?: string; origin?: string | null; body?: unknown } = {}) => new Request(`${ORIGIN}${path}`, {
  method: o.method ?? 'GET',
  headers: { 'content-type': 'application/json', cookie: cookie(o.who ?? 'owner'), ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }) },
  ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
});
let voice: MockCaller;

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  voice = new MockCaller({ allowlist: [PHONE] });
  holderSvc.service = makeService(PHONE);
});
function makeService(allowlist: string) {
  return new VerificationService({
    store: new MemoryVerificationStore(),
    loadResource: async (_c, key) => (key === KEY ? { name: 'Example Center', targetKind: 'expert', targetId: TARGET, evidence: [phoneEvidence()] } : null),
    caseRecord: async () => RECORD,
    contacts: async () => [],
    voice,
    env: { OUTBOUND_ALLOWLIST: allowlist },
    appBaseUrl: 'https://app.example.org',
  });
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
});

const ctx = { params: Promise.resolve({ id: CASE }) };

describe('/api/cases/[id]/verifications', () => {
  it('POST creates a preview (201, nothing dialed); GET lists requests and badges; approve dials once, then 409', async () => {
    const created = await POST(req(`/api/cases/${CASE}/verifications`, { method: 'POST', body: { resourceKey: KEY, sharedFields: ['diseaseName'] } }), ctx);
    expect(created.status).toBe(201);
    const { request } = await created.json();
    expect(request.status).toBe('awaiting_approval');
    expect(voice.calls).toHaveLength(0);
    const list = await GET(req(`/api/cases/${CASE}/verifications`), ctx);
    expect(verificationsResponseSchema.safeParse(await list.json()).success).toBe(true);
    const actx = { params: Promise.resolve({ id: CASE, vid: request.id }) };
    const ok = await APPROVE(req(`/api/cases/${CASE}/verifications/${request.id}/approve`, { method: 'POST', body: {} }), actx);
    expect(ok.status).toBe(200);
    expect(voice.calls).toHaveLength(1);
    const again = await APPROVE(req(`/api/cases/${CASE}/verifications/${request.id}/approve`, { method: 'POST', body: {} }), { params: Promise.resolve({ id: CASE, vid: request.id }) });
    expect(again.status).toBe(409);
  });

  it('cross-origin POST, a non-owner, bad bodies and resources without a phone are refused', async () => {
    expect((await POST(req(`/api/cases/${CASE}/verifications`, { method: 'POST', origin: 'https://evil.example', body: { resourceKey: KEY, sharedFields: ['diseaseName'] } }), ctx)).status).toBe(403);
    expect((await GET(req(`/api/cases/${CASE}/verifications`, { who: 'intruder' }), ctx)).status).toBe(404);
    expect((await POST(req(`/api/cases/${CASE}/verifications`, { method: 'POST', body: { resourceKey: KEY, sharedFields: ['homeCity'] } }), ctx)).status).toBe(400);
    const none = await POST(req(`/api/cases/${CASE}/verifications`, { method: 'POST', body: { resourceKey: 'expert:missing', sharedFields: ['diseaseName'] } }), ctx);
    expect(none.status).toBe(404);
  });

  it('a gate refusal returns 422 with reason codes only', async () => {
    holderSvc.service = makeService('');
    const { request } = await (await POST(req(`/api/cases/${CASE}/verifications`, { method: 'POST', body: { resourceKey: KEY, sharedFields: ['diseaseName'] } }), ctx)).json();
    const res = await APPROVE(req(`/api/cases/${CASE}/verifications/${request.id}/approve`, { method: 'POST', body: {} }), { params: Promise.resolve({ id: CASE, vid: request.id }) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'This call cannot be placed', reasons: ['not_allowlisted'] });
    expect(voice.calls).toHaveLength(0);
  });
});
