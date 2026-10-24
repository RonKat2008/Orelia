import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../lib/agents/intake-extractor', () => ({ extractCase: async () => { throw new Error('synthetic extraction failure'); } }));

import { CREATE_CASE_IP_LIMITS, clientIp, RESEARCH_IP_LIMITS, resetMemoryRateLimitStore } from '../../lib/rate-limit';
import { POST as createCase } from '../../app/api/cases/route';

const ORIGIN = 'http://localhost:3000';
const create = (ip: string | null, forwarded?: string) => new Request(`${ORIGIN}/api/cases`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN, ...(ip ? { 'x-real-ip': ip } : {}), ...(forwarded ? { 'x-forwarded-for': forwarded } : {}) },
  body: JSON.stringify({ reportText: 'Synthetic report text that is long enough to pass validation.' }),
});

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('WAYFINDER_SESSION_SECRET', 'synthetic-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetMemoryRateLimitStore();
});
afterEach(() => { resetMemoryRateLimitStore(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('caps case creation per client IP even when every request is a fresh session', async () => {
  const max = CREATE_CASE_IP_LIMITS('203.0.113.7')[0].max;
  // No cookie on any request: each would mint a new session, so only the IP bounds the client.
  for (let i = 0; i < max; i++) expect((await createCase(create('203.0.113.7', `198.51.100.${i}`))).status).toBe(502);
  const limited = await createCase(create('203.0.113.7', '198.51.100.250'));
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  // Another client is unaffected.
  expect((await createCase(create('203.0.113.8'))).status).toBe(502);
});

it('uses the platform IP, never X-Forwarded-For, and adds no rule without one', () => {
  expect(clientIp(create(null, '198.51.100.1'))).toBeNull();
  expect(clientIp(create(' 203.0.113.9 ', '198.51.100.1'))).toBe('203.0.113.9');
  expect(CREATE_CASE_IP_LIMITS(null)).toEqual([]);
  expect(RESEARCH_IP_LIMITS(null)).toEqual([]);
  expect(RESEARCH_IP_LIMITS('203.0.113.9')[0].key).toBe('research:ip:203.0.113.9');
});
