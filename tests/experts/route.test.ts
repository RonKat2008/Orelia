import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryExpertTraceStore, setExpertTraceStoreForTests } from '@/lib/experts/store';
import { GET, POST } from '@/app/api/cases/[id]/experts/route';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = { params: Promise.resolve({ id: CASE }) };
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};

const req = (method: string, who: string, origin?: string) =>
  new Request(`${ORIGIN}/api/cases/${CASE}/experts`, { method, headers: { cookie: cookie(who), ...(origin ? { origin } : {}) } });

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  setExpertTraceStoreForTests(new MemoryExpertTraceStore());
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setExpertTraceStoreForTests(undefined);
});

describe('experts route guards', () => {
  it('owner GET returns { trace: null } before any run', async () => {
    const res = await GET(req('GET', 'owner'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trace: null });
  });
  it('non-owner gets 404; cross-origin and missing-origin POST get 403', async () => {
    expect((await GET(req('GET', 'other'), ctx)).status).toBe(404);
    expect((await POST(req('POST', 'other', ORIGIN), ctx)).status).toBe(404);
    expect((await POST(req('POST', 'owner', 'https://evil.example.net'), ctx)).status).toBe(403);
    expect((await POST(req('POST', 'owner'), ctx)).status).toBe(403);
  });
});
