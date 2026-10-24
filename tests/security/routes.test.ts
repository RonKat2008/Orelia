import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  CASE_ID, CONTACT_ID, TASK_ID, SECRET, PRIVATE_MARKER, FAILURE,
  routeFiles, routePath, methods, mutates, contextFor, requestFor,
  type Handler, type Method,
} from '../helpers/security/routes';
import { publicRoutes, creationRoutes, statusOnlyRoutes } from './public-routes';

const state = vi.hoisted(() => ({ fail: false, failRuns: false, dbHits: 0, caseReads: 0 }));
// Replace storage/provider boundaries only. Real route handlers, ownership, Origin,
// session verification, signature verification and rate-limit logic remain intact.
vi.mock('../../db/client', () => ({ getDb: () => { state.dbHits++; throw new Error('provider_error_synthetic: SELECT * FROM cases; DATABASE_URL ANTHROPIC_API_KEY\n    at provider (/private/server.ts:42:9)'); } }));
vi.mock('../../app/api/cases/_lib/services', async () => {
  const f = await import('../helpers/security/routes');
  const found = () => {
    state.caseReads++;
    if (state.fail) throw new Error(f.FAILURE);
    return { id: f.CASE_ID, status: 'confirmed', diseaseName: f.PRIVATE_MARKER, goals: [] };
  };
  return { getServices: () => ({
    cases: { get: async () => found(), create: async () => found(), update: async () => found(), compareAndSetStatus: async () => true },
    runs: { listByCase: async () => { if (state.fail || state.failRuns) throw new Error(f.FAILURE); return []; }, create: async () => 'run-1', update: async () => undefined, deleteByCase: async () => undefined },
    persist: { getShortlist: async () => [] },
  }) };
});
// Coordination records storage boundary (memory store, or a provider failure when state.fail).
vi.mock('../../lib/coordination/store', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/coordination/store')>();
  const memory = new actual.MemoryCoordinationStore();
  return { ...actual, getCoordinationStore: () => { if (state.fail) throw new Error('provider_error_synthetic: SELECT * FROM coordination_records; DATABASE_URL\n    at provider (/private/server.ts:42:9)'); return memory; } };
});
vi.mock('../../lib/agents/intake-extractor', () => ({ extractCase: async () => { throw new Error('provider_error_synthetic: SELECT * FROM cases; DATABASE_URL ANTHROPIC_API_KEY\n    at provider (/private/server.ts:42:9)'); } }));
vi.mock('../../scripts/seed-demo', () => ({ main: async () => { throw new Error('provider_error_synthetic: SELECT * FROM cases; DATABASE_URL ANTHROPIC_API_KEY\n    at provider (/private/server.ts:42:9)'); } }));
vi.mock('../../scripts/demo/state', () => ({
  loadState: () => { if (state.fail) throw new Error('provider_error_synthetic: SELECT * FROM cases; DATABASE_URL ANTHROPIC_API_KEY\n    at provider (/private/server.ts:42:9)'); return null; },
  statePath: () => '/tmp/wayfinder-security-unused/state.json',
}));
vi.mock('../../app/api/demo/lib/clock', () => ({
  readSimClock: () => ({}),
  advanceToDay3: () => { if (state.fail) throw new Error('provider_error_synthetic: SELECT * FROM cases; DATABASE_URL ANTHROPIC_API_KEY\n    at provider (/private/server.ts:42:9)'); return {}; },
}));
// Do not enqueue real background work when exercising research admission.
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: vi.fn() }));

import { MemoryOwnerStore } from '../../lib/auth/ownership';
import { signSession } from '../../lib/auth/session';
import { checkRateLimit, CONDITION_BRIEF_LIMITS, DELETE_CASE_LIMITS, getRateLimitStore, REFRESH_RESEARCH_LIMITS, RESEARCH_LIMITS, resetMemoryRateLimitStore } from '../../lib/rate-limit';
import { MemoryHistoryStore } from '../../lib/history/store';
import { MemoryShareStore } from '../../lib/history/share';

const inventory: { route: string; method: Method; handler: Handler }[] = [];
for (const file of routeFiles()) {
  const exports = await import(file);
  for (const method of methods) {
    if (typeof exports[method] === 'function') inventory.push({ route: routePath(file), method, handler: exports[method] });
  }
}
const cookie = (owner: string) => `wf_session=${signSession(owner, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const holder = globalThis as typeof globalThis & { __wayfinderOwnerStore?: MemoryOwnerStore; __wayfinderHistoryStore?: unknown; __wayfinderShareStore?: unknown };
// Memory-backed stores (used when DATABASE_URL is empty) are storage boundaries too: fail them on the error probe.
const failingWhenAsked = <T extends object>(store: T): T => new Proxy(store, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? (...args: unknown[]) => {
      if (state.fail) throw new Error(FAILURE);
      return value.apply(target, args);
    } : value;
  },
});

beforeEach(() => {
  vi.stubEnv('WAYFINDER_SESSION_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('WAYFINDER_DEMO', '0');
  vi.stubEnv('WAYFINDER_OFFLINE', '1');
  vi.stubEnv('WAYFINDER_APP_ORIGIN', '');
  vi.stubEnv('INNGEST_EVENT_KEY', '');
  vi.stubEnv('INNGEST_SIGNING_KEY', '');
  vi.stubEnv('AGENTMAIL_API_KEY', '');
  vi.stubEnv('AGENTCALL_API_KEY', '');
  vi.stubEnv('AGENTMAIL_WEBHOOK_SECRET', 'whsec_c3ludGhldGljLXNlY3JldA==');
  vi.stubEnv('AGENTCALL_WEBHOOK_SECRET', 'synthetic-call-secret');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(FAILURE); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  holder.__wayfinderHistoryStore = failingWhenAsked(new MemoryHistoryStore());
  holder.__wayfinderShareStore = failingWhenAsked(new MemoryShareStore());
  holder.__wayfinderOwnerStore = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore.registerCase(CASE_ID, 'owner');
  holder.__wayfinderOwnerStore.registerContact(CONTACT_ID, CASE_ID);
  holder.__wayfinderOwnerStore.registerTask(TASK_ID, CASE_ID);
  state.fail = false; state.failRuns = false; state.dbHits = 0; state.caseReads = 0;
  resetMemoryRateLimitStore();
});
afterEach(() => {
  delete holder.__wayfinderOwnerStore;
  delete holder.__wayfinderHistoryStore;
  delete holder.__wayfinderShareStore;
  resetMemoryRateLimitStore();
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

async function cleanBody(response: Response) {
  const text = await response.text();
  expect(text).not.toMatch(/provider_error_synthetic|SELECT\s+\*|DATABASE_URL|ANTHROPIC_API_KEY|\bat\s+\S+\s*\([^)]*:\d+:\d+\)|"stack"\s*:/i);
  return text;
}

it('discovers route.ts files and their actual exported HTTP methods, including SDK exports', () => {
  expect(inventory.length).toBeGreaterThan(0);
  for (const file of routeFiles()) expect(inventory.some(item => item.route === routePath(file)), file).toBe(true);
  for (const [route, rule] of Object.entries(publicRoutes)) {
    expect(rule.protection.length).toBeGreaterThan(0);
    expect(inventory.filter(item => item.route === route).map(item => item.method).sort()).toEqual([...rule.methods].sort());
  }
});

for (const { route, method, handler } of inventory) {
  const key = `${route}:${method}`;
  const exempt = publicRoutes[route]?.methods.includes(method);
  const demo = route.startsWith('/api/demo/');
  describe(`${method} ${route}`, () => {
    if (route === '/api/inngest') {
      it('keeps SDK responses clean and refuses unsigned production mutations', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('INNGEST_DEV', '0');
        vi.stubEnv('INNGEST_SIGNING_KEY', 'signkey-test-' + 'ab'.repeat(32));
        const request = requestFor(route, method);
        request.headers.set('x-inngest-signature', 't=0&s=invalid');
        const response = await handler(request, contextFor(route));
        if (method === 'POST') expect(response.status).toBe(401);
        // PUT is SDK registration; a failed outbound sync is also a refusal.
        if (method === 'PUT') expect(response.status).toBeGreaterThanOrEqual(400);
        await cleanBody(response);
      });
    }
    if (!exempt && !demo && !creationRoutes.has(key)) {
      for (const identity of ['other', 'missing', 'tampered'] as const) {
        it(`${identity} session gets an opaque 404 before accessing case data`, async () => {
          const session = identity === 'missing' ? undefined : identity === 'tampered' ? cookie('owner') + 'tampered' : cookie('other');
          const response = await handler(requestFor(route, method, session), contextFor(route));
          expect(response.status).toBe(404);
          const text = await cleanBody(response);
          expect(text).not.toContain(PRIVATE_MARKER);
          expect(text).not.toContain(CASE_ID);
          expect(state.dbHits).toBe(0);
          expect(state.caseReads).toBe(0);
        });
      }
    }
    if (!exempt && mutates(method)) {
      for (const origin of [null, 'https://attacker.example', 'null']) {
        it(`refuses mutation with Origin=${origin ?? '(missing)'}`, async () => {
          if (demo) vi.stubEnv('WAYFINDER_DEMO', '1');
          const response = await handler(requestFor(route, method, cookie('owner'), origin), contextFor(route));
          expect(response.status).toBe(403);
          await cleanBody(response);
        });
      }
    }
    if (demo) {
      for (const flag of ['', '0', 'false', 'TRUE', 'yes', 'true']) {
        it(`is hidden unless WAYFINDER_DEMO=1 (value ${JSON.stringify(flag)})`, async () => {
          vi.stubEnv('WAYFINDER_DEMO', flag);
          const response = await handler(requestFor(route, method, cookie('owner')), contextFor(route));
          expect(response.status).toBe(404);
          await cleanBody(response);
        });
      }
    }
    if (route.startsWith('/api/webhooks/')) {
      for (const signature of [undefined, 'v1,ZmFrZS1zaWduYXR1cmU=']) {
        it(`rejects ${signature ? 'invalid' : 'missing'} provider signature before database access`, async () => {
          const request = requestFor(route, method);
          if (signature) {
            request.headers.set('svix-id', 'synthetic-message-id');
            request.headers.set('svix-timestamp', String(Math.floor(Date.now() / 1000)));
            request.headers.set('svix-signature', signature);
            request.headers.set('x-agentcall-signature', 'sha256=invalid');
          }
          const response = await handler(request, contextFor(route));
          expect(response.status).toBe(401);
          expect(state.dbHits).toBe(0);
          await cleanBody(response);
        });
      }
    }
    if (route.startsWith('/api/cron/')) {
      it('rejects a missing or wrong bearer secret before database access', async () => {
        vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
        for (const auth of [undefined, 'Bearer wrong']) {
          const request = requestFor(route, method);
          if (auth) request.headers.set('authorization', auth);
          const response = await handler(request, contextFor(route));
          expect(response.status).toBe(401);
          expect(state.dbHits).toBe(0);
          await cleanBody(response);
        }
      });
    }
    // Error probes run through the owner path. Uncaught exceptions are failures too:
    // framework-generated responses must not become the route's error contract.
    if (route !== '/api/inngest' && !route.startsWith('/api/webhooks/')) {
      it('keeps storage/provider failures out of response bodies', async () => {
        state.fail = true;
        if (demo) vi.stubEnv('WAYFINDER_DEMO', '1');
        const response = await handler(requestFor(route, method, cookie('owner')), contextFor(route));
        if (!statusOnlyRoutes.has(route) && !statusOnlyRoutes.has(key)) expect(response.status).toBeGreaterThanOrEqual(400);
        await cleanBody(response);
      });
    }
  });
}

// Discover new rate-limited routes as well: they must acquire an executable probe,
// rather than silently escaping admission-control coverage.
const limitedRoutes = routeFiles().filter(file => /checkRateLimit|rateLimitedResponse|withModelRateLimit/.test(readFileSync(file, 'utf8'))).map(routePath);
it('has a route-level saturation probe for every directly rate-limited route', () => {
  expect(limitedRoutes.sort()).toEqual(['/api/cases', '/api/cases/[id]', '/api/cases/[id]/condition-brief', '/api/cases/[id]/experts/refresh', '/api/cases/[id]/history', '/api/cases/[id]/plan', '/api/cases/[id]/research', '/api/review/[token]']);
});
it('research accepts the configured case quota, then returns 429 with Retry-After', async () => {
  const entry = inventory.find(item => item.route === '/api/cases/[id]/research' && item.method === 'POST')!;
  for (let count = 0; count < RESEARCH_LIMITS(CASE_ID, 'owner')[0].max; count++) {
    expect((await entry.handler(requestFor(entry.route, entry.method, cookie('owner')), contextFor(entry.route))).status).toBe(202);
  }
  const response = await entry.handler(requestFor(entry.route, entry.method, cookie('owner')), contextFor(entry.route));
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  await cleanBody(response);
});

it('condition-brief rebuild returns 429 with Retry-After once the case quota is spent', async () => {
  const entry = inventory.find(item => item.route === '/api/cases/[id]/condition-brief' && item.method === 'POST')!;
  const rule = CONDITION_BRIEF_LIMITS(CASE_ID, 'owner')[0];
  for (let count = 0; count < rule.max; count++) expect((await checkRateLimit(getRateLimitStore(), [rule], new Date())).ok).toBe(true);
  const base = requestFor(entry.route, entry.method, cookie('owner'));
  const request = new Request(base.url, { method: 'POST', headers: base.headers, body: JSON.stringify({ refresh: true }) });
  const response = await entry.handler(request, contextFor(entry.route));
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  await cleanBody(response);
});

it('experts refresh returns 429 with Retry-After once the case quota is spent', async () => {
  const entry = inventory.find(item => item.route === '/api/cases/[id]/experts/refresh' && item.method === 'POST')!;
  const rule = REFRESH_RESEARCH_LIMITS(CASE_ID, 'owner')[0];
  for (let count = 0; count < rule.max; count++) expect((await checkRateLimit(getRateLimitStore(), [rule], new Date())).ok).toBe(true);
  const response = await entry.handler(requestFor(entry.route, entry.method, cookie('owner')), contextFor(entry.route));
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  await cleanBody(response);
});

it('case deletion returns 429 with Retry-After once the session quota is spent', async () => {
  const entry = inventory.find(item => item.route === '/api/cases/[id]' && item.method === 'DELETE')!;
  const rule = DELETE_CASE_LIMITS('owner')[0];
  for (let count = 0; count < rule.max; count++) expect((await checkRateLimit(getRateLimitStore(), [rule], new Date())).ok).toBe(true);
  const response = await entry.handler(requestFor(entry.route, entry.method, cookie('owner')), contextFor(entry.route));
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  await cleanBody(response);
});

it('SSE error events redact dependency messages after the stream opens', async () => {
  state.failRuns = true;
  const entry = inventory.find(item => item.route === '/api/cases/[id]/stream' && item.method === 'GET')!;
  const response = await entry.handler(requestFor(entry.route, entry.method, cookie('owner')), contextFor(entry.route));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  await cleanBody(response);
});
it('research enforces the session quota across distinct owned cases, then resets after the window', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  const entry = inventory.find(item => item.route === '/api/cases/[id]/research' && item.method === 'POST')!;
  const rule = RESEARCH_LIMITS(CASE_ID, 'owner')[1];
  const call = async () => {
    const id = crypto.randomUUID();
    holder.__wayfinderOwnerStore!.registerCase(id, 'owner');
    const request = requestFor(entry.route, entry.method, cookie('owner'));
    return entry.handler(new Request(request.url.replace(CASE_ID, id), request), { params: Promise.resolve({ id }) });
  };
  for (let count = 0; count < rule.max; count++) expect((await call()).status).toBe(202);
  const response = await call();
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  await cleanBody(response);
  vi.setSystemTime(new Date(Date.now() + rule.windowMs + 1));
  expect((await call()).status).toBe(202);
});

for (const provider of ['agentmail', 'agentcall'] as const) {
  it(`${provider} signed webhook redacts database failures after signature acceptance`, async () => {
    const route = `/api/webhooks/${provider}`;
    const entry = inventory.find(item => item.route === route && item.method === 'POST')!;
    const body = JSON.stringify(provider === 'agentmail'
      ? { type: 'event', event_type: 'message.received', event_id: 'synthetic-event', message: {
        inbox_id: 'synthetic-inbox', thread_id: 'synthetic-thread', message_id: 'synthetic-message',
        from: 'synthetic@example.test', text: 'Synthetic reply', timestamp: new Date().toISOString(),
      } }
      : { event: 'call.status', timestamp: new Date().toISOString(), data: { callId: 'synthetic-call', status: 'ringing' } });
    const request = new Request(`https://wayfinder.test${route}`, { method: 'POST', body });
    if (provider === 'agentmail') {
      const id = 'synthetic-svix-id';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const key = Buffer.from(process.env.AGENTMAIL_WEBHOOK_SECRET!.slice(6), 'base64');
      const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
      request.headers.set('svix-id', id);
      request.headers.set('svix-timestamp', timestamp);
      request.headers.set('svix-signature', `v1,${signature}`);
    } else {
      request.headers.set('x-agentcall-signature', `sha256=${createHmac('sha256', process.env.AGENTCALL_WEBHOOK_SECRET!).update(body).digest('hex')}`);
    }
    const response = await entry.handler(request, contextFor(route));
    expect(state.dbHits).toBeGreaterThan(0);
    expect(response.status).toBe(500);
    await cleanBody(response);
  });
}

it('doctor review link accepts the per-client GET quota, then returns 429 with Retry-After', async () => {
  const entry = inventory.find(item => item.route === '/api/review/[token]' && item.method === 'GET')!;
  const call = () => entry.handler(requestFor(entry.route, entry.method), contextFor(entry.route));
  let status = 0;
  for (let count = 0; count < 200 && status !== 429; count++) {
    const response = await call();
    status = response.status;
    if (status !== 429) expect(status).toBe(404);
  }
  expect(status).toBe(429);
  const response = await call();
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  await cleanBody(response);
});
