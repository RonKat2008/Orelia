import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryCoordinationStore } from '@/lib/coordination/store';
import { setPacketDepsForTests } from '@/lib/coordination/packet/deps';
import { GET, PATCH, POST } from '@/app/api/cases/[id]/coordination/packets/route';
import { GET as GET_TEXT } from '@/app/api/cases/[id]/coordination/packets/text/route';
import { POST as ATTACH } from '@/app/api/cases/[id]/coordination/packets/attach/route';
import { HISTORY_FIXTURE } from '../../fixtures/coordination/packet/history';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const KEY = 'institution:aaaa1111';
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};
let draftBody = 'Hello\n\nbody';
let approved = false;

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = (fn: Handler, path: string, o: { method?: string; who?: string; body?: unknown; origin?: string } = {}) =>
  fn(new Request(`${ORIGIN}/api/cases/${CASE}/coordination/packets${path}`, {
    method: o.method ?? 'GET',
    headers: { 'content-type': 'application/json', cookie: cookie(o.who ?? 'owner'), ...(o.origin === undefined ? {} : { origin: o.origin }) },
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  }), { params: Promise.resolve({ id: CASE }) });
const write = (fn: Handler, method: string, body: unknown, path = '', who?: string) => call(fn, path, { method, body, origin: ORIGIN, who });

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  draftBody = 'Hello\n\nbody'; approved = false;
  setPacketDepsForTests({
    store: new MemoryCoordinationStore(),
    history: { name: 'fixture', load: async () => HISTORY_FIXTURE },
    inputs: async () => [{ targetKind: 'institution', targetId: 'aaaa1111', name: 'Synthetic Center', contactId: CONTACT, evidence: [] }],
    now: () => new Date('2026-10-24T00:00:00.000Z'),
    outreach: {
      contact: async () => ({ id: CONTACT, caseId: CASE, targetKind: 'institution', targetId: 'aaaa1111', channel: 'email', address: 'a@example.org', state: 'drafted' }) as never,
      consent: async () => ({ contactId: CONTACT, sharedFields: [], approvedAt: '2026-10-24T00:00:00.000Z' }),
      pendingDraft: async () => (approved ? undefined : { id: 'd1', contactId: CONTACT, caseId: CASE, channel: 'email', address: 'a@example.org', body: draftBody, sharedFields: [] }) as never,
      updateDraftBody: async (_id, _c, body) => { if (approved) return false; draftBody = body; return true; },
    },
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setPacketDepsForTests(undefined);
});

describe('packet routes', () => {
  it('non-owner gets 404 and cross-origin writes are refused', async () => {
    expect((await call(GET, '', { who: 'other' })).status).toBe(404);
    expect((await write(POST, 'POST', { resourceKey: KEY }, '', 'other')).status).toBe(404);
    expect((await call(POST, '', { method: 'POST', body: { resourceKey: KEY }, origin: 'http://evil.example' })).status).toBeGreaterThanOrEqual(400);
  });

  it('POST builds (201), GET lists, PATCH ticks, text renders included only, stale PATCH is 409', async () => {
    const created = await write(POST, 'POST', { resourceKey: KEY });
    expect(created.status).toBe(201);
    const { packet } = await created.json();
    expect(packet.version).toBe(1);
    expect((await (await call(GET, '')).json()).packets).toHaveLength(1);

    const patched = await write(PATCH, 'PATCH', { resourceKey: KEY, version: 1, included: { tests: false, questions: true }, questions: ['Is parking available?'] });
    expect(patched.status).toBe(200);
    expect((await write(PATCH, 'PATCH', { resourceKey: KEY, version: 1, included: { tests: true } })).status).toBe(409);

    const { text } = await (await call(GET_TEXT, `/text?resourceKey=${KEY}`)).json();
    expect(text).toContain('Is parking available?');
    expect(text).not.toContain('Key test results');
    expect(text).not.toContain('Records that differ');
  });

  it('validates bodies: bad key 400, too many / too long questions 400, unknown resource 404, no packet 404', async () => {
    expect((await write(POST, 'POST', { resourceKey: 'nope' })).status).toBe(400);
    expect((await write(POST, 'POST', { resourceKey: 'expert:zzz' })).status).toBe(404);
    await write(POST, 'POST', { resourceKey: KEY });
    expect((await write(PATCH, 'PATCH', { resourceKey: KEY, version: 1, questions: Array(11).fill('q') })).status).toBe(400);
    expect((await write(PATCH, 'PATCH', { resourceKey: KEY, version: 1, questions: ['x'.repeat(301)] })).status).toBe(400);
    expect((await call(GET_TEXT, '/text?resourceKey=expert:zzz')).status).toBe(404);
    expect((await call(GET_TEXT, '/text')).status).toBe(400);
  });

  it('attach appends the packet to the pending draft; refuses once approved', async () => {
    await write(POST, 'POST', { resourceKey: KEY });
    const ok = await write(ATTACH, 'POST', { resourceKey: KEY, contactId: CONTACT }, '/attach');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ draftId: 'd1' });
    expect(draftBody).toContain('Prepared by the patient with Wayfinder AI assistance');
    approved = true;
    expect((await write(ATTACH, 'POST', { resourceKey: KEY, contactId: CONTACT }, '/attach')).status).toBe(409);
    expect((await write(ATTACH, 'POST', { resourceKey: KEY, contactId: 'not-a-uuid' }, '/attach')).status).toBe(400);
  });
});
