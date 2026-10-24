import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAppointment, POST as postAppointment } from '@/app/api/appointments/[id]/route';
import { GET as getIcs } from '@/app/api/appointments/[id]/ics/route';
import { GET as getFeed } from '@/app/api/calendar/feed/[token]/route';
import { DELETE as deleteFeed } from '@/app/api/calendar/feeds/[id]/route';
import { GET as listFeeds, POST as createFeed } from '@/app/api/calendar/feeds/route';
import { GET as listCaseAppointments } from '@/app/api/cases/[id]/appointments/route';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { signFeedToken } from '@/lib/appointments/feed';
import { MemoryAppointmentStore } from '@/lib/appointments/store';
import { resetMemoryRateLimitStore } from '@/lib/rate-limit';
import { makeAppointment } from './fixtures';

const ORIGIN = 'https://app.test';
const CASE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CASE_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const APPT_A = 'aaaaaaaa-1111-4111-8111-00000000000a';
const APPT_A_PROPOSED = 'aaaaaaaa-2222-4222-8222-00000000000a';
const APPT_B = 'bbbbbbbb-1111-4111-8111-00000000000b';

const globals = globalThis as { __wayfinderAppointmentStore?: unknown; __wayfinderOwnerStore?: unknown };
let store: MemoryAppointmentStore;

const cookieFor = (id: string) => `wf_session=${signSession(id)}`;
const req = (path: string, who: string | null, init: { method?: string; origin?: boolean; body?: unknown } = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(who ? { cookie: cookieFor(who) } : {}),
      ...(init.origin === false || (init.method ?? 'GET') === 'GET' ? {} : { origin: ORIGIN }),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('WAYFINDER_SESSION_SECRET', 'route-test-secret');
  vi.stubEnv('WAYFINDER_TOKEN_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('WAYFINDER_APP_ORIGIN', '');
  vi.stubEnv('WAYFINDER_APP_BASE_URL', '');
  vi.stubEnv('GOOGLE_CLIENT_ID', '');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
  vi.stubEnv('WAYFINDER_DEMO', '');
  resetMemoryRateLimitStore();

  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE_A, 'alice');
  owners.registerCase(CASE_B, 'bob');
  globals.__wayfinderOwnerStore = owners;

  store = new MemoryAppointmentStore();
  store.owners.set(CASE_A, 'alice');
  store.owners.set(CASE_B, 'bob');
  store.rows.set(APPT_A, makeAppointment({ id: APPT_A, caseId: CASE_A, ownerKey: 'alice', title: 'Alice visit' }));
  store.rows.set(APPT_A_PROPOSED, makeAppointment({ id: APPT_A_PROPOSED, caseId: CASE_A, ownerKey: 'alice', title: 'Alice proposed', status: 'proposed' }));
  store.rows.set(APPT_B, makeAppointment({ id: APPT_B, caseId: CASE_B, ownerKey: 'bob', title: 'Bob visit' }));
  globals.__wayfinderAppointmentStore = store;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete globals.__wayfinderAppointmentStore;
  delete globals.__wayfinderOwnerStore;
});

describe('appointment routes: ownership (IDOR)', () => {
  it("hides another viewer's appointment on GET with a 404", async () => {
    expect((await getAppointment(req(`/api/appointments/${APPT_B}`, 'alice'), ctx({ id: APPT_B }))).status).toBe(404);
  });

  it('hides another viewer\'s appointment on confirm with a 404 and leaves it unchanged', async () => {
    store.rows.set(APPT_B, makeAppointment({ id: APPT_B, caseId: CASE_B, status: 'proposed', candidates: [{ startsAt: '2026-11-10T19:30:00.000Z', endsAt: '2026-11-10T20:30:00.000Z', text: 't', weekdayMismatch: false }] }));
    const res = await postAppointment(req(`/api/appointments/${APPT_B}`, 'alice', { method: 'POST', body: { action: 'confirm', input: { candidate: 0 } } }), ctx({ id: APPT_B }));
    expect(res.status).toBe(404);
    expect(store.rows.get(APPT_B)!.status).toBe('proposed');
  });

  it("hides another viewer's .ics with a 404", async () => {
    expect((await getIcs(req(`/api/appointments/${APPT_B}/ics`, 'alice'), ctx({ id: APPT_B }))).status).toBe(404);
  });

  it('serves the owner their appointment without owner key or Google id', async () => {
    const res = await getAppointment(req(`/api/appointments/${APPT_B}`, 'bob'), ctx({ id: APPT_B }));
    expect(res.status).toBe(200);
    const { appointment } = await res.json();
    expect(appointment.id).toBe(APPT_B);
    expect(appointment).not.toHaveProperty('ownerKey');
    expect(appointment).not.toHaveProperty('googleEventId');
  });

  it('serves the owner a text/calendar file', async () => {
    const res = await getIcs(req(`/api/appointments/${APPT_B}/ics`, 'bob'), ctx({ id: APPT_B }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(await res.text()).toContain('BEGIN:VCALENDAR');
  });

  it('answers 404 without a session', async () => {
    expect((await getAppointment(req(`/api/appointments/${APPT_B}`, null), ctx({ id: APPT_B }))).status).toBe(404);
  });

  it('rejects a mutation without an Origin header with 403', async () => {
    const res = await postAppointment(req(`/api/appointments/${APPT_B}`, 'bob', { method: 'POST', origin: false, body: { action: 'done' } }), ctx({ id: APPT_B }));
    expect(res.status).toBe(403);
    expect(store.rows.get(APPT_B)!.status).toBe('confirmed');
  });

  it('answers 404 for an unknown id and for a non-uuid id', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    expect((await getAppointment(req(`/api/appointments/${unknown}`, 'bob'), ctx({ id: unknown }))).status).toBe(404);
    expect((await getAppointment(req('/api/appointments/nope', 'bob'), ctx({ id: 'nope' }))).status).toBe(404);
  });

  it('lets the owner mutate: marking done', async () => {
    const res = await postAppointment(req(`/api/appointments/${APPT_B}`, 'bob', { method: 'POST', body: { action: 'done' } }), ctx({ id: APPT_B }));
    expect(res.status).toBe(200);
    expect(store.rows.get(APPT_B)!.status).toBe('done');
  });

  it("hides another viewer's case appointment list with a 404", async () => {
    expect((await listCaseAppointments(req(`/api/cases/${CASE_B}/appointments`, 'alice'), ctx({ id: CASE_B }))).status).toBe(404);
    const own = await listCaseAppointments(req(`/api/cases/${CASE_B}/appointments`, 'bob'), ctx({ id: CASE_B }));
    expect(own.status).toBe(200);
    expect((await own.json()).appointments).toHaveLength(1);
  });
});

describe('calendar feed routes', () => {
  async function mintFeed(who: string) {
    const res = await createFeed(req('/api/calendar/feeds', who, { method: 'POST' }));
    expect(res.status).toBe(201);
    const { feed } = await res.json();
    return { id: feed.id as string, url: feed.url as string, token: new URL(feed.url).pathname.split('/').pop()! };
  }

  it('requires a session and an Origin to mint a feed', async () => {
    expect((await createFeed(req('/api/calendar/feeds', null, { method: 'POST' }))).status).toBe(404);
    expect((await createFeed(req('/api/calendar/feeds', 'alice', { method: 'POST', origin: false }))).status).toBe(403);
  });

  it('mints a private signed url and lists it for its owner only', async () => {
    const feed = await mintFeed('alice');
    expect(feed.url).toMatch(/^https:\/\/app\.test\/api\/calendar\/feed\/.+\.ics$/);
    expect((await (await listFeeds(req('/api/calendar/feeds', 'alice'))).json()).feeds).toHaveLength(1);
    expect((await (await listFeeds(req('/api/calendar/feeds', 'bob'))).json()).feeds).toHaveLength(0);
  });

  it("serves text/calendar with only the owner's confirmed appointments", async () => {
    const { token } = await mintFeed('alice');
    const res = await getFeed(req(`/api/calendar/feed/${token}`, null), ctx({ token }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const text = await res.text();
    expect(text).toContain(`UID:${APPT_A}@app.test`);
    expect(text).not.toContain(APPT_A_PROPOSED);
    expect(text).not.toContain(APPT_B);
    expect(text).not.toContain('Bob visit');
  });

  it('refuses a forged or malformed token with 404', async () => {
    const { id } = await mintFeed('alice');
    for (const token of [`${id}.forged.ics`, 'nonsense', `${id}`, signFeedToken('cccccccc-cccc-4ccc-8ccc-cccccccccccc')]) {
      expect((await getFeed(req(`/api/calendar/feed/${token}`, null), ctx({ token }))).status).toBe(404);
    }
  });

  it('lets only the owner revoke, after which the feed url answers 404', async () => {
    const { id, token } = await mintFeed('alice');
    const byBob = await deleteFeed(req(`/api/calendar/feeds/${id}`, 'bob', { method: 'DELETE' }), ctx({ id }));
    expect(byBob.status).toBe(404);
    expect((await getFeed(req(`/api/calendar/feed/${token}`, null), ctx({ token }))).status).toBe(200);

    expect((await deleteFeed(req(`/api/calendar/feeds/${id}`, 'alice', { method: 'DELETE', origin: false }), ctx({ id }))).status).toBe(403);
    const byAlice = await deleteFeed(req(`/api/calendar/feeds/${id}`, 'alice', { method: 'DELETE' }), ctx({ id }));
    expect(byAlice.status).toBe(200);
    expect((await getFeed(req(`/api/calendar/feed/${token}`, null), ctx({ token }))).status).toBe(404);
    expect((await deleteFeed(req(`/api/calendar/feeds/${id}`, 'alice', { method: 'DELETE' }), ctx({ id }))).status).toBe(404);
  });

  it('caps live feeds at three per viewer', async () => {
    for (let i = 0; i < 3; i++) await mintFeed('alice');
    expect((await createFeed(req('/api/calendar/feeds', 'alice', { method: 'POST' }))).status).toBe(409);
  });
});
