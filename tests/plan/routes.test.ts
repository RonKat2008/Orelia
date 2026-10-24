import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const planner = vi.hoisted(() => ({ buildContactPlan: vi.fn(), applyPlanEdits: vi.fn() }));
vi.mock('@/lib/plan', () => planner);

import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { setPlanApprovedEmitterForTests } from '@/lib/plan/approved-event';
import { setPlanInputLoaderForTests } from '@/lib/plan/inputs';
import { MemoryPlanStore, setPlanStoreForTests } from '@/lib/plan/store';
import { GET, PATCH, POST } from '@/app/api/cases/[id]/plan/route';
import { makePlan } from './plan-fixture';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};

const call = (fn: typeof GET | typeof POST | typeof PATCH, o: { method?: string; who?: string; origin?: string; body?: unknown; id?: string } = {}) =>
  fn(new Request(`${ORIGIN}/api/cases/${o.id ?? CASE}/plan`, {
    method: o.method ?? 'GET',
    headers: { 'content-type': 'application/json', cookie: cookie(o.who ?? 'owner'), ...(o.origin === undefined ? {} : { origin: o.origin }) },
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  }), ctx(o.id ?? CASE));
const post = (o: Parameters<typeof call>[1] = {}) => call(POST, { method: 'POST', origin: ORIGIN, body: { llm: false }, ...o });
const patch = (o: Parameters<typeof call>[1] = {}) => call(PATCH, { method: 'PATCH', origin: ORIGIN, ...o });

let plans: MemoryPlanStore;
let selected: unknown[];
const emitted = vi.fn(async () => undefined);

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  plans = new MemoryPlanStore();
  setPlanStoreForTests(plans);
  selected = [{ targetKind: 'expert', targetId: 'e1', name: 'Synthetic Expert', contactId: null, evidence: [] }];
  setPlanInputLoaderForTests({ load: async () => selected as never });
  emitted.mockClear();
  setPlanApprovedEmitterForTests(emitted);
  planner.buildContactPlan.mockReset().mockImplementation(async (caseId: string) => makePlan(caseId));
  planner.applyPlanEdits.mockReset();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setPlanStoreForTests(undefined);
  setPlanInputLoaderForTests(undefined);
  setPlanApprovedEmitterForTests(undefined);
});

describe('plan routes: guards', () => {
  it('non-owner gets 404 on GET/POST/PATCH and nothing is built or changed', async () => {
    await plans.save(makePlan(CASE));
    expect((await call(GET, { who: 'other' })).status).toBe(404);
    expect((await post({ who: 'other' })).status).toBe(404);
    expect((await patch({ who: 'other', body: { version: 1, edits: [{ type: 'approve' }] } })).status).toBe(404);
    expect(planner.buildContactPlan).not.toHaveBeenCalled();
    expect(planner.applyPlanEdits).not.toHaveBeenCalled();
    expect((await plans.latest(CASE))?.version).toBe(1);
  });

  it('cross-origin and missing-origin POST/PATCH are 403', async () => {
    await plans.save(makePlan(CASE));
    for (const origin of ['https://evil.example.net', undefined]) {
      expect((await call(POST, { method: 'POST', origin, body: {} })).status).toBe(403);
      expect((await call(PATCH, { method: 'PATCH', origin, body: { version: 1, edits: [{ type: 'approve' }] } })).status).toBe(403);
    }
    expect(planner.buildContactPlan).not.toHaveBeenCalled();
    expect(planner.applyPlanEdits).not.toHaveBeenCalled();
  });

  it('invalid case id is 400 on every method', async () => {
    expect((await call(GET, { id: 'not-a-uuid' })).status).toBe(400);
    expect((await post({ id: 'not-a-uuid' })).status).toBe(400);
    expect((await patch({ id: 'not-a-uuid', body: { version: 1, edits: [{ type: 'approve' }] } })).status).toBe(400);
  });
});

describe('plan routes: behaviour', () => {
  it('GET is 404 before a plan exists, then returns it', async () => {
    expect((await call(GET)).status).toBe(404);
    await plans.save(makePlan(CASE));
    const res = await call(GET);
    expect(res.status).toBe(200);
    expect((await res.json()).plan.caseId).toBe(CASE);
  });

  it('POST with no selection is 422 and builds nothing', async () => {
    selected = [];
    const res = await post();
    expect(res.status).toBe(422);
    expect(planner.buildContactPlan).not.toHaveBeenCalled();
    expect(await plans.latest(CASE)).toBeNull();
  });

  it('POST builds with llm:false, saves a draft, and a rebuild bumps the version', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect((await res.json()).plan).toMatchObject({ version: 1, status: 'draft' });
    expect(planner.buildContactPlan).toHaveBeenCalledWith(CASE, selected, expect.objectContaining({ llm: false }));
    const again = await post();
    expect(again.status).toBe(201);
    expect((await again.json()).plan.version).toBe(2);
  });

  it('PATCH 404 when no plan, 400 on a malformed body', async () => {
    expect((await patch({ body: { version: 1, edits: [{ type: 'approve' }] } })).status).toBe(404);
    await plans.save(makePlan(CASE));
    const bad = await patch({ body: { version: 1, edits: [] } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'Invalid body' });
  });

  it('PATCH with a stale version is 409 and does not apply edits', async () => {
    await plans.save(makePlan(CASE, { version: 3 }));
    const res = await patch({ body: { version: 2, edits: [{ type: 'approve' }] } });
    expect(res.status).toBe(409);
    expect(planner.applyPlanEdits).not.toHaveBeenCalled();
  });

  it('PATCH toggle saves the edited plan without emitting an approval event', async () => {
    const current = makePlan(CASE);
    await plans.save(current);
    planner.applyPlanEdits.mockReturnValue({ ok: true, plan: { ...current, version: 2 } });
    const edits = [{ type: 'toggle', resourceKey: 'expert:e1', stepId: 's2', enabled: false }];
    const res = await patch({ body: { version: 1, edits } });
    expect(res.status).toBe(200);
    expect((await res.json()).plan.version).toBe(2);
    expect(planner.applyPlanEdits).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), edits, expect.any(Date));
    expect(emitted).not.toHaveBeenCalled();
  });

  it('PATCH approve persists approval and emits plan/approved once', async () => {
    const current = makePlan(CASE);
    await plans.save(current);
    const approvedAt = '2026-10-24T13:00:00.000Z';
    planner.applyPlanEdits.mockReturnValue({ ok: true, plan: { ...current, version: 2, status: 'approved', approvedAt } });
    const res = await patch({ body: { version: 1, edits: [{ type: 'approve' }] } });
    expect(res.status).toBe(200);
    expect(await plans.latest(CASE)).toMatchObject({ status: 'approved', approvedAt });
    expect(emitted).toHaveBeenCalledExactlyOnceWith(CASE, 2);
  });

  it('a failing event emitter does not fail the approval', async () => {
    const current = makePlan(CASE);
    await plans.save(current);
    emitted.mockRejectedValueOnce(new Error('engine down'));
    planner.applyPlanEdits.mockReturnValue({ ok: true, plan: { ...current, version: 2, status: 'approved', approvedAt: '2026-10-24T13:00:00.000Z' } });
    expect((await patch({ body: { version: 1, edits: [{ type: 'approve' }] } })).status).toBe(200);
  });

  it('edit validation errors from the planner are 400', async () => {
    await plans.save(makePlan(CASE));
    planner.applyPlanEdits.mockReturnValue({ ok: false, error: 'unknown step' });
    const res = await patch({ body: { version: 1, edits: [{ type: 'toggle', resourceKey: 'expert:zz', stepId: 'q', enabled: true }] } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown step' });
  });

  it('internal failures use the generic envelope and leak nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    planner.buildContactPlan.mockRejectedValue(new Error('postgres://user:secret@db.internal/x exploded'));
    const res = await post();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Unable to build the contact plan' });
    expect(text).not.toMatch(/secret|postgres|exploded/);
    spy.mockRestore();
  });
});
