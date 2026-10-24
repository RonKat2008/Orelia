import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { setConsultDepsForTests } from '@/lib/coordination/consult';
import { resetMemoryRateLimitStore } from '@/lib/rate-limit';
import * as doctors from '@/app/api/cases/[id]/coordination/doctors/route';
import * as doctor from '@/app/api/cases/[id]/coordination/doctors/[doctorId]/route';
import * as consults from '@/app/api/cases/[id]/coordination/consults/route';
import * as consult from '@/app/api/cases/[id]/coordination/consults/[consultId]/route';
import * as review from '@/app/api/review/[token]/route';
import { CASE, DOCTOR_EMAIL, harness, RESOURCE_KEY, tokenFrom, type Harness } from './consult-fixture';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};
let h: Harness;

const req = (path: string, o: { method?: string; who?: string | null; origin?: string | null; body?: unknown; ip?: string } = {}) => new Request(`${ORIGIN}${path}`, {
  method: o.method ?? 'GET',
  headers: {
    'content-type': 'application/json',
    ...(o.who === null ? {} : { cookie: `wf_session=${signSession(o.who ?? 'owner', { WAYFINDER_SESSION_SECRET: SECRET })}` }),
    ...(o.origin === null ? {} : o.method && o.method !== 'GET' ? { origin: o.origin ?? ORIGIN } : {}),
    'x-forwarded-for': o.ip ?? '203.0.113.7',
  },
  ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
});
const base = `/api/cases/${CASE}/coordination`;
const caseCtx = { params: Promise.resolve({ id: CASE }) };

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  resetMemoryRateLimitStore();
  h = harness();
  setConsultDepsForTests(h.deps);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setConsultDepsForTests(undefined);
  resetMemoryRateLimitStore();
});

async function setup() {
  const d = await (await doctors.POST(req(`${base}/doctors`, { method: 'POST', body: { name: 'Dr. Synthetic Lee', email: DOCTOR_EMAIL } }), caseCtx)).json();
  const res = await consults.POST(req(`${base}/consults`, { method: 'POST', body: { resourceKey: RESOURCE_KEY, doctorId: d.doctor.id, sharedFields: ['diseaseName'] } }), caseCtx);
  expect(res.status).toBe(201);
  const c = (await res.json()).consult;
  return { doctorId: d.doctor.id as string, consult: c };
}
const patch = (id: string, body: unknown, o: Parameters<typeof req>[1] = {}) =>
  consult.PATCH(req(`${base}/consults/${id}`, { method: 'PATCH', body, ...o }), { params: Promise.resolve({ id: CASE, consultId: id }) });
const rctx = (token: string) => ({ params: Promise.resolve({ token }) });

describe('patient routes', () => {
  it('doctors: add, list, delete (409 while in use)', async () => {
    const { doctorId, consult: c } = await setup();
    const list = await (await doctors.GET(req(`${base}/doctors`), caseCtx)).json();
    expect(list.doctors).toHaveLength(1);
    const del = () => doctor.DELETE(req(`${base}/doctors/${doctorId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: CASE, doctorId }) });
    expect((await del()).status).toBe(409);
    expect((await patch(c.id, { version: 1, action: 'cancel' })).status).toBe(200);
    expect((await del()).status).toBe(204);
  });

  it('non-owner 404 and cross-origin 403 on every patient route', async () => {
    const { consult: c } = await setup();
    expect((await doctors.GET(req(`${base}/doctors`, { who: 'other' }), caseCtx)).status).toBe(404);
    expect((await consults.GET(req(`${base}/consults`, { who: 'other' }), caseCtx)).status).toBe(404);
    expect((await patch(c.id, { version: 1, action: 'send_to_doctor' }, { who: 'other' })).status).toBe(404);
    expect((await patch(c.id, { version: 1, action: 'send_to_doctor' }, { origin: 'https://evil.example.net' })).status).toBe(403);
    expect((await doctors.POST(req(`${base}/doctors`, { method: 'POST', origin: null, body: { name: 'X', email: 'x@example.org' } }), caseCtx)).status).toBe(403);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('GET consults never returns the token hash; refusals carry codes only', async () => {
    const { consult: c } = await setup();
    expect((await patch(c.id, { version: 1, action: 'send_to_doctor' })).status).toBe(200);
    const list = await (await consults.GET(req(`${base}/consults`), caseCtx)).json();
    expect(list.consults[0].reviewTokenHash).toBeNull();
    const refused = await patch(c.id, { version: 2, action: 'send' });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: expect.any(String), reasons: ['consult_not_ready'] });
    expect((await patch(c.id, { version: 1, action: 'consent' })).status).toBe(409);
    expect((await patch(c.id, { version: 2, action: 'nope' })).status).toBe(400);
  });
});

describe('public review route', () => {
  async function linked() {
    const { consult: c } = await setup();
    await patch(c.id, { version: 1, action: 'send_to_doctor' });
    return { id: c.id as string, token: tokenFrom(h.mailer.sent[0].body) };
  }

  it('GET returns the request only, without a session', async () => {
    const { token } = await linked();
    const res = await review.GET(req(`/api/review/${token}`, { who: null }), rctx(token));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { review: v } = await res.json();
    expect(v.status).toBe('sent_to_doctor');
    expect(JSON.stringify(v)).not.toMatch(/Fictional|Springfield|dr\.lee@|11111111-/);
  });

  it('unknown, forged and used tokens all get the same generic 404', async () => {
    const { token } = await linked();
    const bodies: unknown[] = [];
    for (const t of ['x', `${token}x`, token.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))]) {
      const res = await review.GET(req(`/api/review/${t}`, { who: null }), rctx(t));
      expect(res.status).toBe(404);
      bodies.push(await res.json());
    }
    expect(new Set(bodies.map(b => JSON.stringify(b))).size).toBe(1);
    const ok = await review.POST(req(`/api/review/${token}`, { method: 'POST', who: null, body: { decision: 'decline' } }), rctx(token));
    expect(ok.status).toBe(200);
    const used = await review.GET(req(`/api/review/${token}`, { who: null }), rctx(token));
    expect(used.status).toBe(404);
    expect(JSON.stringify(await used.json())).toBe(JSON.stringify(bodies[0]));
    const again = await review.POST(req(`/api/review/${token}`, { method: 'POST', who: null, body: { decision: 'decline' } }), rctx(token));
    expect(again.status).toBe(409);
  });

  it('POST needs same origin and a valid body', async () => {
    const { token } = await linked();
    expect((await review.POST(req(`/api/review/${token}`, { method: 'POST', who: null, origin: 'https://evil.example.net', body: { decision: 'decline' } }), rctx(token))).status).toBe(403);
    expect((await review.POST(req(`/api/review/${token}`, { method: 'POST', who: null, body: { decision: 'approve', subject: '', body: '' } }), rctx(token))).status).toBe(400);
  });

  it('approving with the disclosure removed adds it back and says so', async () => {
    const { token } = await linked();
    const v = (await (await review.GET(req(`/api/review/${token}`, { who: null }), rctx(token))).json()).review;
    const res = await review.POST(req(`/api/review/${token}`, { method: 'POST', who: null, body: { decision: 'approve', subject: v.subject, body: 'Dear colleagues, please advise on this case.' } }), rctx(token));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.review.status).toBe('doctor_approved');
    expect(json.notice).toMatch(/added back/);
  });

  it('rate limits by client IP', async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await review.GET(req('/api/review/x', { who: null, ip: '198.51.100.9' }), rctx('x'))).status;
    expect(last).toBe(429);
  });
});
