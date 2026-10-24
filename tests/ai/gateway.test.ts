import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeClient, hasClaudeCredentials } from '@/lib/ai/gateway';
import { modelFor } from '@/config/models';
import { chat } from '@/lib/ai/chat';
import { embed, fakeEmbed, DIMENSIONS } from '@/lib/ai/embeddings';
import { runAgent } from '@/lib/agents/runtime';
import { MemoryRunStore } from '@/lib/agents/run-store';
import { z } from 'zod';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function gateway() {
  vi.stubEnv('NEON_AI_GATEWAY_BASE_URL', 'https://gateway.example/prefix/');
  vi.stubEnv('NEON_AI_GATEWAY_TOKEN', 'test-token');
  vi.stubEnv('WAYFINDER_OFFLINE', '0');
}
describe('AI gateway', () => {
  it('constructs bearer-auth Anthropic gateway without a direct API key', () => {
    gateway(); vi.stubEnv('ANTHROPIC_API_KEY', '');
    const client = createClaudeClient();
    expect(client.baseURL).toBe('https://gateway.example/prefix/anthropic');
    expect(client.authToken).toBe('test-token');
    expect(client.apiKey).toBeNull();
    expect(hasClaudeCredentials()).toBe(true);
    expect(modelFor('research')).toBe('claude-haiku-4-5');
    expect(modelFor('curator')).toBe('claude-opus-5-5');
    vi.stubEnv('WAYFINDER_MODEL_CURATOR', 'gemini-3-flash');
    expect(modelFor('curator')).toBe('gemini-3-flash');
  });
  it('runs live with gateway credentials and no direct key', async () => {
    gateway(); vi.stubEnv('ANTHROPIC_API_KEY', ''); vi.stubEnv('WAYFINDER_RECORD_LLM', '');
    const create = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }] });
    const result = await runAgent({ name: 'gateway-test', model: modelFor('research'), system: 'Return JSON', prompt: 'go',
      tools: [], output: z.object({ ok: z.boolean() }), caseId: 'synthetic', store: new MemoryRunStore(),
      offlineKey: 'does-not-exist', client: { messages: { create } } });
    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledOnce();
  });
  it('retains direct defaults and credentials', () => {
    vi.stubEnv('NEON_AI_GATEWAY_BASE_URL', ''); vi.stubEnv('ANTHROPIC_API_KEY', 'direct');
    expect(createClaudeClient().apiKey).toBe('direct');
    expect(modelFor('research')).toBe('claude-haiku-5-5');
  });
  it('routes configured role chat through OpenAI-compatible gateway', async () => {
    gateway(); vi.stubEnv('WAYFINDER_MODEL_INBOX', 'gpt-5-mini');
    const request = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: 'result' } }] }));
    vi.stubGlobal('fetch', request);
    expect(await chat({ role: 'inbox', messages: [{ role: 'user', content: 'hello' }] })).toBe('result');
    expect(request.mock.calls[0][0]).toBe('https://gateway.example/prefix/v1/chat/completions');
    expect(JSON.parse(request.mock.calls[0][1].body).model).toBe('gpt-5-mini');
  });
});
describe('embeddings', () => {
  it('is deterministic, unit normalized, order/case insensitive and offline without credentials', async () => {
    vi.stubEnv('NEON_AI_GATEWAY_BASE_URL', '');
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    expect(fakeEmbed('Sarcoma rare sarcoma')).toEqual(fakeEmbed('SARCOMA sarcoma rare'));
    expect(fakeEmbed('rare')).not.toEqual(fakeEmbed('different'));
    for (const text of ['', 'hello world', '中文 résumé']) {
      const vector = fakeEmbed(text);
      expect(vector).toHaveLength(DIMENSIONS);
      expect(Math.hypot(...vector)).toBeCloseTo(1);
    }
    expect(await embed(['hello'])).toEqual([fakeEmbed('hello')]);
    expect(request).not.toHaveBeenCalled();
  });
  it('batches <=150, restores index order and normalizes returned vectors', async () => {
    gateway();
    const request = vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body).input as string[];
      return Response.json({ data: input.map((_, index) => ({ index, embedding: [2, ...Array(1023).fill(0)] })).reverse() });
    });
    vi.stubGlobal('fetch', request);
    const result = await embed(Array(301).fill('text'));
    expect(result).toHaveLength(301);
    expect(request.mock.calls.map(call => JSON.parse(call[1].body).input.length)).toEqual([150, 150, 1]);
    expect(result[0][0]).toBe(1);
  });
  it('retries 429 with a bounded delay', async () => {
    gateway(); vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: [1, ...Array(1023).fill(0)] }] }));
    vi.stubGlobal('fetch', request);
    const pending = embed(['text']);
    await vi.runAllTimersAsync();
    expect(await pending).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid response dimensions', async () => {
    gateway(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ index: 0, embedding: [1] }] })));
    await expect(embed(['text'])).rejects.toThrow('Invalid embedding response');
  });
});
