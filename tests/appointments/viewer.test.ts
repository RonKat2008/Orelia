import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listMine } from '@/app/api/appointments/route';
import { GET as listFeeds, POST as createFeed } from '@/app/api/calendar/feeds/route';
import { HeaderAccountResolver, setAccountResolverForTests } from '@/lib/accounts/current';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { accountIdFromKey, getViewer } from '@/lib/auth/viewer';
import { MemoryAppointmentStore } from '@/lib/appointments/store';
import { resetMemoryRateLimitStore } from '@/lib/rate-limit';
import { makeAppointment } from './fixtures';

const ORIGIN = 'https://app.test';
const CASE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const globals = globalThis as { __wayfinderAppointmentStore?: unknown; __wayfinderOwnerStore?: unknown };

const req = (opts: { account?: string; session?: string; method?: string } = {}) => new Request(`${ORIGIN}/api/x`, {
  method: opts.method ?? 'GET',
  headers: {
    ...(opts.account ? { 'x-test-account': opts.account } : {}),
    ...(opts.session ? { cookie: `wf_session=${signSession(opts.session)}` } : {}),
    ...(opts.method && opts.method !== 'GET' ? { origin: ORIGIN } : {}),
  },
});

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('WAYFINDER_SESSION_SECRET', 'viewer-test-secret');
  vi.stubEnv('WAYFINDER_TOKEN_KEY', Buffer.alloc(32, 9).toString('base64'));
  vi.stubEnv('WAYFINDER_APP_ORIGIN', '');
  resetMemoryRateLimitStore();
  setAccountResolverForTests(new HeaderAccountResolver());
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE_A, 'browser-1', 'acct-1');
  globals.__wayfinderOwnerStore = owners;
  const store = new MemoryAppointmentStore();
  store.owners.set(CASE_A, 'account:acct-1');
  store.rows.set('a1', makeAppointment({ id: 'a1', caseId: CASE_A, ownerKey: 'account:acct-1', title: 'Account visit' }));
  globals.__wayfinderAppointmentStore = store;
});
afterEach(() => {
  setAccountResolverForTests(undefined);
  delete globals.__wayfinderAppointmentStore;
  delete globals.__wayfinderOwnerStore;
  vi.unstubAllEnvs();
});

describe('calendar viewer with accounts', () => {
  it('prefers the signed-in account over the browser session', async () => {
    expect(await getViewer(req({ account: 'acct-1', session: 'browser-1' }))).toEqual({ kind: 'account', key: 'account:acct-1', accountId: 'acct-1' });
    expect(await getViewer(req({ session: 'browser-1' }))).toEqual({ kind: 'session', key: 'browser-1' });
    expect(accountIdFromKey('account:acct-1')).toBe('acct-1');
    expect(accountIdFromKey('browser-1')).toBeNull();
  });

  it("lists an account's appointments and keys its feeds on the account", async () => {
    const mine = await listMine(req({ account: 'acct-1' }));
    expect(mine.status).toBe(200);
    expect((await mine.json()).appointments.map((a: { title: string }) => a.title)).toEqual(['Account visit']);
    expect((await createFeed(req({ account: 'acct-1', method: 'POST' }))).status).toBe(201);
    expect((await (await listFeeds(req({ account: 'acct-1' }))).json()).feeds).toHaveLength(1);
  });

  it('an account or session that owns no case gets an opaque 404', async () => {
    expect((await listMine(req({ account: 'acct-2' }))).status).toBe(404);
    expect((await listFeeds(req({ session: 'stranger' }))).status).toBe(404);
    expect((await createFeed(req({ account: 'acct-2', method: 'POST' }))).status).toBe(404);
  });
});
