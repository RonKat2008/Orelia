import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), listByCase: vi.fn() }));
vi.mock('@/app/api/cases/_lib/services', () => ({ getServices: () => ({ cases: { get: mocks.get }, runs: { listByCase: mocks.listByCase } }) }));
import { GET } from '@/app/api/cases/[id]/usage/route';
const id = 'd035540d-6cda-42c4-ad94-ad1e9b8a027f';
function request(caseId = id) { return GET(new Request('http://localhost'), { params: Promise.resolve({ id: caseId }) }); }
afterEach(() => vi.clearAllMocks());
it('returns totals and per-agent accounting without run content', async () => {
  mocks.get.mockResolvedValue({ id });
  mocks.listByCase.mockResolvedValue([{ agent: 'trials', tokensIn: 12, tokensOut: 3, costUsd: 1, outputSummary: 'private', error: 'private' }]);
  const response = await request();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.totals.tokensIn).toBe(12); expect(body.agents[0].agent).toBe('trials');
  expect(JSON.stringify(body)).not.toContain('private');
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('validates ids and missing cases', async () => {
  expect((await request('bad')).status).toBe(400);
  mocks.get.mockResolvedValue(null);
  expect((await request()).status).toBe(404);
  expect(mocks.listByCase).not.toHaveBeenCalled();
});
