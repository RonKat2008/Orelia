import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryShareStore, setShareStoreForTests, verifyShareToken } from '@/lib/history/share';
import { DELETE } from '@/app/api/cases/[id]/history/share/[shareId]/route';
import { GET, POST } from '@/app/api/cases/[id]/history/share/route';
import { CASE_A, CASE_B } from './share-fixtures';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};
const KEYS = ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_SHARE_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL'];

const req = (method: string, path: string, o: { who?: string; origin?: string; body?: unknown } = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookie(o.who ?? 'owner'), ...(o.origin === undefined ? {} : { origin: o.origin }) },
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  });
const base = (id: string) => `/api/cases/${id}/history/share`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const create = (id = CASE_A, o: { who?: string; origin?: string; body?: unknown } = {}) =>
  POST(req('POST', base(id), { origin: ORIGIN, body: { sections: ['diagnosis', 'lab'], expiresInDays: 7, label: 'Dr. Lee' }, ...o }), ctx(id));

let store: MemoryShareStore;
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_SHARE_SECRET; delete process.env.WAYFINDER_DEMO; delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE_A, 'owner');
  owners.registerCase(CASE_B, 'other');
  holder.__wayfinderOwnerStore = owners;
  store = new MemoryShareStore();
  setShareStoreForTests(store);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setShareStoreForTests(undefined);
});

describe('POST share', () => {
  it('creates a share and returns a one-time url whose token verifies', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    const { share, url } = await res.json();
    expect(share.caseId).toBe(CASE_A);
    expect(share.sections).toEqual(['diagnosis', 'lab']);
    expect(url.startsWith(`${ORIGIN}/share/history/`)).toBe(true);
    const token = url.split('/share/history/')[1];
    expect(verifyShareToken(token, new Date())).toEqual({ shareId: share.id });
    expect(JSON.stringify(share)).not.toContain(token);
  });
  it('validates the body', async () => {
    expect((await create(CASE_A, { body: { sections: [], expiresInDays: 7 } })).status).toBe(400);
    expect((await create(CASE_A, { body: { sections: ['diagnosis'], expiresInDays: 99 } })).status).toBe(400);
  });
  it('rejects non-owners and cross-origin posts', async () => {
    expect((await create(CASE_A, { who: 'stranger' })).status).toBeGreaterThanOrEqual(403);
    expect((await create(CASE_A, { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('GET share', () => {
  it('lists shares with computed status', async () => {
    const { share } = await (await create()).json();
    await store.create({ ...share, id: 'old', expiresAt: '2020-01-01T00:00:00.000Z' });
    const body = await (await GET(req('GET', base(CASE_A)), ctx(CASE_A))).json();
    const status = Object.fromEntries(body.shares.map((s: { id: string; status: string }) => [s.id, s.status]));
    expect(status).toEqual({ [share.id]: 'active', old: 'expired' });
  });
  it('does not expose another case\'s shares', async () => {
    await create();
    expect((await GET(req('GET', base(CASE_A), { who: 'other' }), ctx(CASE_A))).status).toBeGreaterThanOrEqual(403);
  });
});

describe('DELETE share', () => {
  it('revokes and then reports revoked', async () => {
    const { share } = await (await create()).json();
    const res = await DELETE(req('DELETE', `${base(CASE_A)}/${share.id}`, { origin: ORIGIN }), { params: Promise.resolve({ id: CASE_A, shareId: share.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).share.revokedAt).not.toBeNull();
    const list = await (await GET(req('GET', base(CASE_A)), ctx(CASE_A))).json();
    expect(list.shares[0].status).toBe('revoked');
  });
  it('404s for a share that belongs to another case', async () => {
    const { share } = await (await create(CASE_B, { who: 'other' })).json();
    const res = await DELETE(req('DELETE', `${base(CASE_A)}/${share.id}`, { origin: ORIGIN }), { params: Promise.resolve({ id: CASE_A, shareId: share.id }) });
    expect(res.status).toBe(404);
    expect((await store.get(share.id))?.revokedAt).toBeNull();
  });
  it('400s on a malformed share id', async () => {
    const res = await DELETE(req('DELETE', `${base(CASE_A)}/nope`, { origin: ORIGIN }), { params: Promise.resolve({ id: CASE_A, shareId: 'nope' }) });
    expect(res.status).toBe(400);
  });
});
