import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryCoordinationStore } from '@/lib/coordination/store';
import { setBoardDepsForTests } from '@/lib/coordination/board-deps';
import { boardSchema } from '@/lib/coordination/contract';
import { GET } from '@/app/api/cases/[id]/coordination/board/route';

const SECRET = 'test-secret';
const CASE = '11111111-1111-4111-8111-111111111111';
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};
const get = (who: string) => GET(new Request(`http://localhost/api/cases/${CASE}/coordination/board`, {
  headers: { cookie: `wf_session=${signSession(who, { WAYFINDER_SESSION_SECRET: SECRET })}` },
}), { params: Promise.resolve({ id: CASE }) });

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO; delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  setBoardDepsForTests({
    store: new MemoryCoordinationStore(), now: () => new Date('2026-10-24T00:00:00.000Z'), names: async () => ({}),
    contacts: async () => [{ id: 'c1', resourceKey: 'expert:e1', state: 'drafted', nextFollowUpAt: null }], tasks: async () => [],
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  setBoardDepsForTests(undefined);
});

describe('board route', () => {
  it('owner gets a schema-valid { board }; non-owner gets 404', async () => {
    const res = await get('owner');
    expect(res.status).toBe(200);
    const { board } = await res.json();
    expect(boardSchema.safeParse(board).success).toBe(true);
    expect(board.items).toHaveLength(1);
    expect((await get('other')).status).toBe(404);
  });
});
