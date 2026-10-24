import { describe, expect, it, vi } from 'vitest';
import { suggestFreeSlots, eventPayload } from '@/lib/integrations/google/calendar';
import { connectionFromTokens, googleSync, MemoryConnectionStore } from '@/lib/integrations/google/connection';
import {
  authorizationUrl, checkFlow, exchangeCode, googleConfig, OAUTH_TTL_MS, pkceChallenge, pkcePair, refreshAccess, safeReturnTo,
  SCOPE_EVENTS, SCOPE_FREEBUSY, startFlow, TOKEN_ENDPOINT, type TokenResponse,
} from '@/lib/integrations/google/oauth';
import { makeAppointment } from '../appointments/fixtures';

const env = { WAYFINDER_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') };
const cfg = { clientId: 'client-id', clientSecret: 'client-secret' };
const now = new Date('2026-10-24T15:00:00Z');

const tokens = (over: Partial<TokenResponse> = {}): TokenResponse => ({
  accessToken: 'access-PLAINTEXT-1', expiresAt: new Date(now.getTime() + 3600_000), refreshToken: 'refresh-PLAINTEXT-1', scopes: [SCOPE_EVENTS], ...over,
});

interface Call { url: string; method: string; headers: Record<string, string>; body: string }
function mockFetch(handler: (c: Call) => unknown, status = 200) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input), method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? ''),
    };
    calls.push(call);
    return new Response(JSON.stringify(handler(call)), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates a verifier whose challenge matches and is unique per call', () => {
    const a = pkcePair();
    expect(pkceChallenge(a.verifier)).toBe(a.challenge);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkcePair().verifier).not.toBe(a.verifier);
  });
});

describe('authorizationUrl', () => {
  it('asks for offline access, S256 PKCE and incremental scopes with only calendar.events by default', () => {
    const { flow, challenge } = startFlow('alice', [SCOPE_EVENTS], '/calendar', now, env);
    const url = new URL(authorizationUrl(cfg, { redirectUri: 'https://app.test/cb', scopes: flow.scopes, state: flow.state, challenge }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe(flow.state);
    expect(url.searchParams.get('scope')).toBe(SCOPE_EVENTS);
    expect(url.searchParams.get('scope')).not.toContain('freebusy');
  });
});

describe('googleConfig', () => {
  it('is null unless both client id and secret are set', () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'a' })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: ' a ', GOOGLE_CLIENT_SECRET: 'b' })).toEqual({ clientId: 'a', clientSecret: 'b' });
  });
});

describe('OAuth flow cookie', () => {
  const begin = () => startFlow('alice', [SCOPE_EVENTS], '/calendar', now, env);

  it('accepts a matching state and viewer', () => {
    const { flow, cookieValue } = begin();
    const out = checkFlow(cookieValue, flow.state, 'alice', now, env);
    expect(out).toMatchObject({ ok: true, flow: { verifier: flow.verifier, viewerKey: 'alice' } });
  });

  it('keeps the verifier out of the clear in the cookie', () => {
    const { flow, cookieValue } = begin();
    expect(cookieValue).not.toContain(flow.verifier);
    expect(cookieValue).not.toContain(flow.state);
  });

  it('rejects a missing cookie', () => {
    expect(checkFlow(undefined, 's', 'alice', now, env)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a state mismatch', () => {
    const { cookieValue } = begin();
    expect(checkFlow(cookieValue, 'other', 'alice', now, env)).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(checkFlow(cookieValue, null, 'alice', now, env)).toEqual({ ok: false, reason: 'state_mismatch' });
  });

  it('rejects a different viewer', () => {
    const { flow, cookieValue } = begin();
    expect(checkFlow(cookieValue, flow.state, 'bob', now, env)).toEqual({ ok: false, reason: 'viewer_mismatch' });
    expect(checkFlow(cookieValue, flow.state, null, now, env)).toEqual({ ok: false, reason: 'viewer_mismatch' });
  });

  it('rejects an expired flow', () => {
    const { flow, cookieValue } = begin();
    const later = new Date(now.getTime() + OAUTH_TTL_MS + 1);
    expect(checkFlow(cookieValue, flow.state, 'alice', later, env)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a tampered or foreign-key cookie', () => {
    const { flow, cookieValue } = begin();
    const [v, iv, ct, tag] = cookieValue.split('.');
    const bytes = Buffer.from(ct, 'base64url');
    bytes[0] ^= 1;
    expect(checkFlow([v, iv, bytes.toString('base64url'), tag].join('.'), flow.state, 'alice', now, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkFlow(cookieValue, flow.state, 'alice', now, { WAYFINDER_TOKEN_KEY: Buffer.alloc(32, 1).toString('base64') })).toEqual({ ok: false, reason: 'invalid' });
    expect(checkFlow('garbage', flow.state, 'alice', now, env)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('safeReturnTo', () => {
  it.each(['//evil.com', 'https://evil.com', '\\\\evil.com', 'javascript:alert(1)', '/a?x=https://evil.com', '', null, undefined])('rejects %j', v => {
    expect(safeReturnTo(v)).toBe('/calendar');
  });
  it('keeps a same-site path', () => {
    expect(safeReturnTo('/calendar')).toBe('/calendar');
    expect(safeReturnTo('/cases/abc/appointments')).toBe('/cases/abc/appointments');
  });
  it('is applied when a flow starts', () => {
    expect(startFlow('a', [SCOPE_EVENTS], '//evil.com', now, env).flow.returnTo).toBe('/calendar');
  });
});

describe('token endpoint', () => {
  it('exchangeCode posts the code_verifier and parses the response', async () => {
    const { fetcher, calls } = mockFetch(() => ({ access_token: 'at', expires_in: 3600, refresh_token: 'rt', scope: `${SCOPE_EVENTS} openid` }));
    const out = await exchangeCode(cfg, 'the-code', 'the-verifier', 'https://app.test/cb', fetcher, now);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_ENDPOINT);
    expect(calls[0].method).toBe('POST');
    const form = new URLSearchParams(calls[0].body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('code_verifier')).toBe('the-verifier');
    expect(form.get('redirect_uri')).toBe('https://app.test/cb');
    expect(out).toEqual({ accessToken: 'at', refreshToken: 'rt', scopes: [SCOPE_EVENTS, 'openid'], expiresAt: new Date(now.getTime() + 3600_000) });
  });

  it('refreshAccess uses the refresh_token grant', async () => {
    const { fetcher, calls } = mockFetch(() => ({ access_token: 'at2', expires_in: 60 }));
    const out = await refreshAccess(cfg, 'rt', fetcher, now);
    const form = new URLSearchParams(calls[0].body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('rt');
    expect(out.refreshToken).toBeUndefined();
    expect(out.scopes).toEqual([]);
  });

  it('throws on an error status or a malformed body', async () => {
    await expect(exchangeCode(cfg, 'c', 'v', 'r', mockFetch(() => ({}), 400).fetcher, now)).rejects.toThrow('400');
    await expect(exchangeCode(cfg, 'c', 'v', 'r', mockFetch(() => ({ nope: 1 })).fetcher, now)).rejects.toThrow('Malformed');
  });
});

describe('connectionFromTokens', () => {
  it('seals tokens so the plaintext never appears in the stored row', () => {
    const c = connectionFromTokens('alice', tokens(), undefined, env);
    const json = JSON.stringify(c);
    expect(json).not.toContain('PLAINTEXT');
    expect(c.refreshTokenSealed).toMatch(/^v1\./);
    expect(c.calendarId).toBe('primary');
    expect(c.freeBusyOptIn).toBe(false);
  });

  it('keeps the previous refresh token on incremental consent and merges scopes', () => {
    const first = connectionFromTokens('alice', tokens(), undefined, env);
    const second = connectionFromTokens('alice', tokens({ refreshToken: undefined, scopes: [SCOPE_FREEBUSY], accessToken: 'access-PLAINTEXT-2' }), first, env);
    expect(second.refreshTokenSealed).toBe(first.refreshTokenSealed);
    expect(second.scopes.sort()).toEqual([SCOPE_EVENTS, SCOPE_FREEBUSY].sort());
    expect(second.freeBusyOptIn).toBe(true);
  });
});

describe('googleSync', () => {
  async function connected(opts: { expired?: boolean } = {}) {
    const store = new MemoryConnectionStore();
    const expiresAt = opts.expired ? new Date(now.getTime() - 1000) : new Date(now.getTime() + 3600_000);
    await store.save(connectionFromTokens('alice', tokens({ expiresAt }), undefined, env));
    return store;
  }

  it('inserts a new event then patches an existing one', async () => {
    const store = await connected();
    const { fetcher, calls } = mockFetch(c => (c.method === 'POST' ? { id: 'evt-9' } : {}));
    const sync = googleSync({ store, fetcher, env, now: () => now, config: cfg });

    const id = await sync.upsert('alice', makeAppointment());
    expect(id).toBe('evt-9');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(calls[0].headers.Authorization).toBe('Bearer access-PLAINTEXT-1');
    const body = JSON.parse(calls[0].body);
    expect(body.summary).toBe('Appointment with Cleveland Clinic');
    expect(body.reminders.overrides.map((o: { minutes: number }) => o.minutes)).toEqual([1440, 120]);

    const again = await sync.upsert('alice', makeAppointment({ googleEventId: 'evt-9' }));
    expect(again).toBe('evt-9');
    expect(calls[1].method).toBe('PATCH');
    expect(calls[1].url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-9');
  });

  it('returns null without calling Google when the viewer has no connection', async () => {
    const { fetcher, calls } = mockFetch(() => ({}));
    const sync = googleSync({ store: new MemoryConnectionStore(), fetcher, env, now: () => now, config: cfg });
    expect(await sync.upsert('nobody', makeAppointment())).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('refreshes an expired access token and stores the new one sealed', async () => {
    const store = await connected({ expired: true });
    const { fetcher, calls } = mockFetch(c => (c.url === TOKEN_ENDPOINT ? { access_token: 'access-PLAINTEXT-NEW', expires_in: 3600 } : { id: 'evt-1' }));
    const sync = googleSync({ store, fetcher, env, now: () => now, config: cfg });

    expect(await sync.upsert('alice', makeAppointment())).toBe('evt-1');
    expect(calls[0].url).toBe(TOKEN_ENDPOINT);
    expect(new URLSearchParams(calls[0].body).get('refresh_token')).toBe('refresh-PLAINTEXT-1');
    expect(calls[1].headers.Authorization).toBe('Bearer access-PLAINTEXT-NEW');
    const stored = await store.get('alice');
    expect(JSON.stringify(stored)).not.toContain('PLAINTEXT');
    expect(new Date(stored!.accessExpiresAt!).getTime()).toBeGreaterThan(now.getTime());
    expect(stored!.refreshTokenSealed).toBeTruthy();
  });

  it('does nothing when the token is expired and Google is not configured', async () => {
    const store = await connected({ expired: true });
    const { fetcher, calls } = mockFetch(() => ({}));
    const sync = googleSync({ store, fetcher, env, now: () => now, config: null });
    expect(await sync.upsert('alice', makeAppointment())).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('removes the event only when one exists', async () => {
    const store = await connected();
    const { fetcher, calls } = mockFetch(() => ({}));
    const sync = googleSync({ store, fetcher, env, now: () => now, config: cfg });
    await sync.remove('alice', makeAppointment());
    expect(calls).toHaveLength(0);
    await sync.remove('alice', makeAppointment({ googleEventId: 'evt-3' }));
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain('/events/evt-3');
  });

  it('disconnect revokes the token at Google and removes the row', async () => {
    const store = await connected();
    const { fetcher, calls } = mockFetch(() => ({}));
    const sync = googleSync({ store, fetcher, env, now: () => now, config: cfg });
    await sync.disconnect('alice');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/revoke');
    expect(new URLSearchParams(calls[0].body).get('token')).toBe('refresh-PLAINTEXT-1');
    expect(await store.get('alice')).toBeUndefined();
  });

  it('disconnect still removes the row when revocation fails', async () => {
    const store = await connected();
    const fetcher = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await googleSync({ store, fetcher, env, now: () => now, config: cfg }).disconnect('alice');
    expect(await store.get('alice')).toBeUndefined();
  });

  it('freeTimes is empty without the freebusy opt-in', async () => {
    const store = await connected();
    const { fetcher, calls } = mockFetch(() => ({}));
    expect(await googleSync({ store, fetcher, env, now: () => now, config: cfg }).freeTimes('alice', 'America/New_York')).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('eventPayload', () => {
  it('maps a cancelled appointment to status cancelled and carries the appointment id privately', () => {
    const a = makeAppointment({ status: 'cancelled' });
    const p = eventPayload(a, 'desc');
    expect(p.status).toBe('cancelled');
    expect(p.extendedProperties.private.wayfinderAppointmentId).toBe(a.id);
    expect(p.start).toEqual({ dateTime: a.startsAt, timeZone: 'America/New_York' });
  });
});

describe('suggestFreeSlots', () => {
  const friday = new Date('2026-10-23T15:00:00Z');

  it('skips weekends and starts on the next business day', () => {
    const slots = suggestFreeSlots([], friday, 'America/New_York', { count: 3 });
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatch(/^Mon, Oct 26, 9:00 AM/);
    expect(slots.some(s => /^(Sat|Sun)/.test(s))).toBe(false);
  });

  it('avoids busy intervals', () => {
    // Monday 9:00-11:00 ET (EDT, UTC-4) is busy, so Monday's slot moves to 11:00.
    const busy = [{ start: '2026-10-26T13:00:00Z', end: '2026-10-26T15:00:00Z' }];
    const slots = suggestFreeSlots(busy, friday, 'America/New_York', { count: 1 });
    expect(slots[0]).toMatch(/^Mon, Oct 26, 11:00 AM/);
  });

  it('skips a day that is busy all day', () => {
    const busy = [{ start: '2026-10-26T12:00:00Z', end: '2026-10-27T00:00:00Z' }];
    expect(suggestFreeSlots(busy, friday, 'America/New_York', { count: 1 })[0]).toMatch(/^Tue, Oct 27/);
  });
});
