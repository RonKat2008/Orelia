import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { setPlanApprovedEmitterForTests } from '@/lib/plan/approved-event';
import { setPlanMaterializerForTests } from '@/lib/plan/materialize-wiring';
import { setPlanInputLoaderForTests } from '@/lib/plan/inputs';
import { MemoryPlanStore, setPlanStoreForTests } from '@/lib/plan/store';
import { PATCH, POST } from '@/app/api/cases/[id]/plan/route';
import { emailEv, phoneEv, resource } from '../plan/planner-fixtures';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const cookie = `wf_session=${signSession('owner', { WAYFINDER_SESSION_SECRET: SECRET })}`;
const req = (method: string, body: unknown) => new Request(`${ORIGIN}/api/cases/${CASE}/plan`, {
  method, headers: { 'content-type': 'application/json', cookie, origin: ORIGIN }, body: JSON.stringify(body),
});
const ctx = () => ({ params: Promise.resolve({ id: CASE }) });
const post = () => POST(req('POST', { llm: false }), ctx());
const patch = (body: unknown) => PATCH(req('PATCH', body), ctx());

let store: MemoryPlanStore;
const materialize = vi.fn(async () => []);
beforeEach(() => {
  vi.stubEnv('WAYFINDER_SESSION_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL', '');
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  store = new MemoryPlanStore();
  setPlanStoreForTests(store);
  const inputs = [resource('trial', 't1', [emailEv('org_contact', 'info@aid.example.org'), phoneEv('org_contact', '+16175550100')])];
  setPlanInputLoaderForTests({ load: async () => inputs });
  setPlanApprovedEmitterForTests(async () => undefined);
  setPlanMaterializerForTests(materialize as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete holder.__wayfinderOwnerStore;
  setPlanStoreForTests(undefined); setPlanInputLoaderForTests(undefined);
  setPlanApprovedEmitterForTests(undefined); setPlanMaterializerForTests(undefined);
});

describe('regenerating the plan after patient edits', () => {
  it('keeps a step the patient turned off turned off when the plan is rebuilt from unchanged inputs', async () => {
    expect((await post()).status).toBe(201);
    const off = await patch({ version: 1, edits: [{ type: 'toggle', resourceKey: 'trial:t1', stepId: 's2', enabled: false }] });
    expect(off.status).toBe(200);
    expect((await post()).status).toBe(201);
    const plan = (await store.latest(CASE))!;
    // BUG: POST rebuilds from rules and overwrites the stored plan, so the call the patient switched off is back on.
    expect(plan.resources[0].steps.find(s => s.id === 's2')?.enabled).toBe(false);
  });

  it('does not silently revoke an approved plan (or re-run approval side effects) on rebuild', async () => {
    await post();
    expect((await patch({ version: 1, edits: [{ type: 'approve' }] })).status).toBe(200);
    expect(materialize).toHaveBeenCalledTimes(1);
    const res = await post();
    // BUG: 201 and the plan is back to 'draft' with approvedAt null, while the drafts/workflow from the approval keep
    // running; approving again materializes a second time and emits a second plan/approved run.
    expect(res.status).toBe(409);
    expect((await store.latest(CASE))!.status).toBe('approved');
  });

  it('two concurrent first builds produce one winner and one 409', async () => {
    const [a, b] = await Promise.all([post(), post()]);
    // BUG: with no stored plan, save() runs without expectedVersion, so both writes win (last writer silently replaces).
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});
