import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices } from '@/app/api/cases/_lib/services';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryExpertTraceStore, setExpertTraceStoreForTests } from '@/lib/experts/store';
import { resetMemoryRateLimitStore } from '@/lib/rate-limit';
import { POST } from '@/app/api/cases/[id]/experts/refresh/route';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '22222222-2222-4222-8222-222222222222';
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = { params: Promise.resolve({ id: CASE }) };
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};
const req = (who: string, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/cases/${CASE}/experts/refresh`, { method: 'POST', headers: { cookie: cookie(who), ...(origin ? { origin } : {}) } });

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL', 'WAYFINDER_OFFLINE']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  process.env.WAYFINDER_OFFLINE = '1';
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  setExpertTraceStoreForTests(new MemoryExpertTraceStore());
  resetMemoryRateLimitStore();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setExpertTraceStoreForTests(undefined);
  vi.restoreAllMocks();
});

describe('POST /api/cases/[id]/experts/refresh', () => {
  it('is owner-only and same-origin', async () => {
    expect((await POST(req('other'), ctx)).status).toBe(404);
    expect((await POST(req('owner', 'https://evil.example.net'), ctx)).status).toBe(403);
    expect((await POST(req('owner', null), ctx)).status).toBe(403);
  });

  it('returns 404 for a case that does not exist', async () => {
    expect((await POST(req('owner'), ctx)).status).toBe(404);
  });

  it('refreshes offline (no network), then rate-limits a burst', async () => {
    vi.spyOn(getServices().cases, 'get').mockResolvedValue({ id: CASE, diseaseName: 'Vascular Ehlers-Danlos syndrome' } as never);
    const first = await POST(req('owner'), ctx);
    expect(first.status).toBe(201);
    const body = await first.json() as { trace: { caseId: string }; added: { affiliations: number; contactPoints: number } };
    expect(body.trace.caseId).toBe(CASE);
    expect(body.added).toEqual({ affiliations: 0, contactPoints: 0 });
    expect((await POST(req('owner'), ctx)).status).toBe(201);
    expect((await POST(req('owner'), ctx)).status).toBe(201);
    expect((await POST(req('owner'), ctx)).status).toBe(429);
  });
});
