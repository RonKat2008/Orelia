import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { setPlanInputLoaderForTests } from '@/lib/plan/inputs';
import { MemoryCoordinationStore, setCoordinationStoreForTests } from '@/lib/coordination/store';
import { setRequirementsDepsForTests } from '@/lib/coordination/requirements/deps';
import { GET, PATCH, POST } from '@/app/api/cases/[id]/coordination/requirements/route';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const URL_ = `${ORIGIN}/api/cases/${CASE}/coordination/requirements`;
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};

type Opts = { method?: string; who?: string; origin?: string; body?: unknown; raw?: string; id?: string };
const call = (fn: typeof GET | typeof POST | typeof PATCH, o: Opts = {}) =>
  fn(new Request(URL_.replace(CASE, o.id ?? CASE), {
    method: o.method ?? 'GET',
    headers: { 'content-type': 'application/json', cookie: cookie(o.who ?? 'owner'), ...(o.origin === undefined ? {} : { origin: o.origin }) },
    ...(o.raw !== undefined ? { body: o.raw } : o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  }), ctx(o.id ?? CASE));
const post = (o: Opts = {}) => call(POST, { method: 'POST', origin: ORIGIN, ...o });
const patch = (o: Opts = {}) => call(PATCH, { method: 'PATCH', origin: ORIGIN, ...o });

const PAGE = 'https://clinic.example.org/new-patients';
const EV = { id: 'ev1', claimType: 'center_page', claim: 'A referral letter is required for new patients.', sourceUrl: PAGE, sourceKind: 'exa' };
let selected: unknown[];

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  setCoordinationStoreForTests(new MemoryCoordinationStore());
  selected = [{ targetKind: 'institution', targetId: 'abc-123', name: 'Synthetic Clinic', contactId: null, evidence: [EV] }];
  setPlanInputLoaderForTests({ load: async () => selected as never });
  setRequirementsDepsForTests({ exa: null, probe: null, offline: true, now: () => new Date('2026-10-24T12:00:00Z'), listDocs: async () => [] });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setCoordinationStoreForTests(undefined);
  setPlanInputLoaderForTests(undefined);
  setRequirementsDepsForTests(undefined);
});

describe('requirements route', () => {
  it('GET is empty before building, then lists checklists', async () => {
    expect(await (await call(GET)).json()).toEqual({ checklists: [] });
    expect((await post()).status).toBe(201);
    const body = await (await call(GET)).json();
    expect(body.checklists).toHaveLength(1);
    expect(body.checklists[0].requirements[0]).toMatchObject({ kind: 'referral_letter', sourceUrl: PAGE, status: 'missing' });
  });

  it('POST with no body builds all; with resourceKey builds one; unknown key is 404', async () => {
    const all = await post();
    expect(all.status).toBe(201);
    expect((await all.json()).checklists).toHaveLength(1);
    expect((await post({ body: { resourceKey: 'institution:abc-123' } })).status).toBe(201);
    expect((await post({ body: { resourceKey: 'institution:nope' } })).status).toBe(404);
  });

  it('POST validates its body', async () => {
    expect((await post({ raw: '{nope' })).status).toBe(400);
    expect((await post({ body: { resourceKey: 5 } })).status).toBe(400);
    expect((await post({ body: { extra: 1 } })).status).toBe(400);
  });

  it('POST is 422 with no selected resources', async () => {
    selected = [];
    expect((await post()).status).toBe(422);
  });

  it('guards: unknown session owner, wrong origin, invalid id', async () => {
    expect((await call(GET, { who: 'stranger' })).status).toBeGreaterThanOrEqual(403);
    expect((await post({ origin: 'http://evil.test' })).status).toBe(403);
    expect((await call(GET, { id: 'not-a-uuid' })).status).toBe(400);
    expect((await patch({ who: 'stranger', body: {} })).status).toBeGreaterThanOrEqual(403);
  });

  it('PATCH updates status and note, 400 on invalid, 409 on stale version, 404 on unknown', async () => {
    await post();
    const ok = await patch({ body: { resourceKey: 'institution:abc-123', version: 1, requirementId: 'r1', status: 'patient_to_request', note: 'asked Dr. Lee' } });
    expect(ok.status).toBe(200);
    const { checklist } = await ok.json();
    expect(checklist.version).toBe(2);
    expect(checklist.requirements[0]).toMatchObject({ status: 'patient_to_request', note: 'asked Dr. Lee' });

    expect((await patch({ body: { resourceKey: 'institution:abc-123', version: 1, requirementId: 'r1', status: 'missing' } })).status).toBe(409);
    expect((await patch({ body: { resourceKey: 'institution:abc-123', version: 2, requirementId: 'r1', status: 'bogus' } })).status).toBe(400);
    expect((await patch({ body: { resourceKey: 'institution:abc-123', version: 2, requirementId: 'zz', status: 'have' } })).status).toBe(404);
    expect((await patch({ body: { resourceKey: 'institution:other', version: 1, requirementId: 'r1', status: 'have' } })).status).toBe(404);
  });
});
