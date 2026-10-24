import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { MemoryOwnerStore } from '../../lib/auth/ownership';
import { signSession } from '../../lib/auth/session';
import { HISTORY_ADD_LIMITS, PLAN_BUILD_LIMITS, resetMemoryRateLimitStore } from '../../lib/rate-limit';
import { MemoryHistoryStore } from '../../lib/history/store';
import { POST as addRecord } from '../../app/api/cases/[id]/history/route';
import { DELETE as deleteRecord } from '../../app/api/cases/[id]/history/documents/[docId]/route';
import { POST as buildPlan } from '../../app/api/cases/[id]/plan/route';

const SECRET = 'synthetic-secret';
const ORIGIN = 'http://localhost:3000';
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const holder = globalThis as typeof globalThis & { __wayfinderOwnerStore?: MemoryOwnerStore; __wayfinderHistoryStore?: unknown };
const cookie = `wf_session=${signSession('owner', { WAYFINDER_SESSION_SECRET: SECRET })}`;
const headers = (ip?: string) => ({ 'content-type': 'application/json', origin: ORIGIN, cookie, ...(ip ? { 'x-real-ip': ip } : {}) });
const ctx = { params: Promise.resolve({ id: CASE_ID }) };

beforeEach(() => {
  vi.stubEnv('WAYFINDER_SESSION_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('WAYFINDER_OFFLINE', '1');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  holder.__wayfinderHistoryStore = new MemoryHistoryStore();
  holder.__wayfinderOwnerStore = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore.registerCase(CASE_ID, 'owner');
  resetMemoryRateLimitStore();
});
afterEach(() => {
  delete holder.__wayfinderOwnerStore; delete holder.__wayfinderHistoryStore;
  resetMemoryRateLimitStore(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

it('bounds a delete-and-re-add loop on history records per case', async () => {
  const max = HISTORY_ADD_LIMITS(CASE_ID, 's', null)[0].max;
  let limited = 0;
  for (let i = 0; i < max + 3; i++) {
    const res = await addRecord(new Request(`${ORIGIN}/api/cases/${CASE_ID}/history`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ title: `Note ${i}`, text: 'Seen for fatigue. Started iron 65 mg daily.' }),
    }), ctx);
    if (res.status === 429) { limited++; continue; }
    expect(res.status).toBe(201);
    const { document } = await res.json() as { document: { id: string } };
    const del = await deleteRecord(new Request(`${ORIGIN}/api/cases/${CASE_ID}/history/documents/${document.id}`, { method: 'DELETE', headers: headers() }),
      { params: Promise.resolve({ id: CASE_ID, docId: document.id }) });
    expect(del.status).toBeLessThan(300);
  }
  expect(limited).toBe(3);
});

it('exposes per-case, per-session and per-IP rules for history adds and plan builds', () => {
  expect(HISTORY_ADD_LIMITS(CASE_ID, 's', '203.0.113.1').map(r => r.key)).toEqual([
    `history-add:case:${CASE_ID}`, 'history-add:session:s', 'history-add:ip:203.0.113.1',
  ]);
  expect(PLAN_BUILD_LIMITS(CASE_ID, 's', null)).toHaveLength(2);
  expect(PLAN_BUILD_LIMITS(CASE_ID, 's', '203.0.113.1')).toHaveLength(3);
});

it('429s a plan rebuild once the per-case budget is spent, before any model work', async () => {
  const max = PLAN_BUILD_LIMITS(CASE_ID, 's', null)[0].max;
  const statuses: number[] = [];
  for (let i = 0; i < max + 1; i++) {
    const res = await buildPlan(new Request(`${ORIGIN}/api/cases/${CASE_ID}/plan`, { method: 'POST', headers: headers(), body: '{}' }), ctx);
    statuses.push(res.status);
  }
  expect(statuses.at(-1)).toBe(429);
  expect(statuses.slice(0, max).every(s => s !== 429)).toBe(true);
});
