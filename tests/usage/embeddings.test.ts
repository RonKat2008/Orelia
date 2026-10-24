import { afterEach, expect, it, vi } from 'vitest';
import { embed, DIMENSIONS } from '@/lib/ai/embeddings';
import { usageContext } from '@/lib/ai/usage';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('captures embedding token usage inside the current agent context', async () => {
  vi.stubEnv('WAYFINDER_OFFLINE', '');
  vi.stubEnv('NEON_AI_GATEWAY_BASE_URL', 'https://gateway.example');
  vi.stubEnv('NEON_AI_GATEWAY_TOKEN', 'test');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ model: 'qwen3-embedding-0-6b', usage: { prompt_tokens: 42, total_tokens: 42 }, data: [{ index: 0, embedding: [1, ...Array(DIMENSIONS - 1).fill(0)] }] })));
  const capture = vi.fn(); const beforeCall = vi.fn();
  await usageContext.run({ capture, beforeCall }, () => embed(['example']));
  expect(capture).toHaveBeenCalledWith('qwen3-embedding-0-6b', { prompt_tokens: 42, total_tokens: 42 });
  expect(beforeCall).toHaveBeenCalledTimes(1);
});
it('fake embeddings never create paid usage', async () => {
  vi.stubEnv('WAYFINDER_OFFLINE', '1');
  const capture = vi.fn(); const beforeCall = vi.fn();
  await usageContext.run({ capture, beforeCall }, () => embed(['example']));
  expect(capture).not.toHaveBeenCalled(); expect(beforeCall).not.toHaveBeenCalled();
});
