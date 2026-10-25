import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { embed, DIMENSIONS } from '@/lib/ai/embeddings';

const ok = () => Response.json({ model: 'qwen3-embedding-0-6b', data: [{ index: 0, embedding: [1, ...Array(DIMENSIONS - 1).fill(0)] }] });
const status = (code: number) => new Response('upstream unavailable', { status: code });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('WAYFINDER_OFFLINE', '');
  vi.stubEnv('NEON_AI_GATEWAY_BASE_URL', 'https://gateway.example');
  vi.stubEnv('NEON_AI_GATEWAY_TOKEN', 'test');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('retries a transient 503 and returns the vectors once the gateway recovers', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok());
  vi.stubGlobal('fetch', fetchMock);
  const pending = embed(['example']);
  await vi.runAllTimersAsync();
  const [vector] = await pending;
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(vector).toHaveLength(DIMENSIONS);
});

it('gives up after the retry budget and reports the last status', async () => {
  const fetchMock = vi.fn().mockResolvedValue(status(503));
  vi.stubGlobal('fetch', fetchMock);
  const pending = embed(['example']);
  pending.catch(() => undefined);
  await vi.runAllTimersAsync();
  await expect(pending).rejects.toThrow('Embedding request failed (503)');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('does not retry a non-transient failure', async () => {
  const fetchMock = vi.fn().mockResolvedValue(status(401));
  vi.stubGlobal('fetch', fetchMock);
  await expect(embed(['example'])).rejects.toThrow('Embedding request failed (401)');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
