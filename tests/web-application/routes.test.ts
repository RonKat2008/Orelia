import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api/cases/_lib/services', () => ({ getServices: () => ({ cases: { get: async (id: string) => ({ id }) } }) }));

import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { WebApplicationDraft } from '@/lib/web-application/types';
import { GET } from '@/app/api/cases/[id]/applications/route';
import { POST } from '@/app/api/cases/[id]/applications/[applicationId]/approve/route';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown; __wayfinderApplications?: unknown };
const cookie = `wf_session=${signSession('owner', { WAYFINDER_SESSION_SECRET: SECRET })}`;
const draft = (caseId: string): WebApplicationDraft => ({
  id: APP, caseId, contactId: null, url: 'http://localhost:3000/dev/test-application', fields: [], missing: [], formFingerprint: 'f1-x',
  screenshot: 'png', sharedFields: [], sharedDocIds: [], status: 'draft', approvedAt: null, submittedAt: null, result: null,
  createdAt: '2026-10-24T12:00:00.000Z',
});

let store: MemoryApplicationStore;
beforeEach(() => {
  vi.stubEnv('WAYFINDER_SESSION_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL', '');
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  owners.registerCase(OTHER, 'owner');
  holder.__wayfinderOwnerStore = owners;
  store = new MemoryApplicationStore();
  holder.__wayfinderApplications = store;
});
afterEach(() => { vi.unstubAllEnvs(); delete holder.__wayfinderOwnerStore; delete holder.__wayfinderApplications; });

const approve = (caseId: string, applicationId = APP) => POST(new Request(`${ORIGIN}/api/cases/${caseId}/applications/${applicationId}/approve`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: ORIGIN }, body: '{}',
}), { params: Promise.resolve({ id: caseId, applicationId }) });

describe('application routes', () => {
  it('GET lists the case applications', async () => {
    await store.save(draft(CASE));
    const res = await GET(new Request(`${ORIGIN}/api/cases/${CASE}/applications`, { headers: { cookie } }), { params: Promise.resolve({ id: CASE }) });
    expect(res.status).toBe(200);
    expect((await res.json()).applications.map((a: { id: string }) => a.id)).toEqual([APP]);
  });

  it('approve refuses an application of another case as not found, and an invalid id as 400', async () => {
    await store.save(draft(OTHER));
    expect((await approve(CASE)).status).toBe(404);
    expect((await approve(CASE, 'nope')).status).toBe(400);
    expect((await store.get(APP))?.status).toBe('draft');
  });

  it('approve without consent is refused and nothing is submitted', async () => {
    await store.save(draft(CASE));
    const res = await approve(CASE);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toEqual(['consent_required']);
    expect((await store.get(APP))?.status).toBe('draft');
  });
});
