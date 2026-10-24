import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgent, type MessagesClient } from '@/lib/agents/runtime';
import { MemoryRunStore } from '@/lib/agents/run-store';
import { emptyUsage } from '@/lib/ai/usage';

beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', ''); vi.stubEnv('ANTHROPIC_API_KEY', 'test'); vi.stubEnv('WAYFINDER_CASE_BUDGET_USD', '3'); });
afterEach(() => vi.unstubAllEnvs());
function setup(replies: Partial<Anthropic.Message>[]) {
  const create = vi.fn(async () => replies.shift() as Anthropic.Message);
  const store = new MemoryRunStore();
  const opts = { name: 'trials', model: 'claude-haiku-4-5', system: '', prompt: '', tools: [], output: z.object({ ok: z.boolean() }), caseId: 'c', offlineKey: 'epithelioid-sarcoma', store, client: { messages: { create } } as MessagesClient };
  return { create, store, opts };
}
function response(text = '{"ok":true}', input = 1000): Partial<Anthropic.Message> { return { model: 'claude-haiku-4-5', stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage, content: [{ type: 'text', text, citations: null }] }; }
it('persists every response including validation retries', async () => {
  const { opts, store } = setup([response('invalid'), response()]);
  await runAgent(opts);
  expect((await store.listByCase('c'))[0]).toMatchObject({ tokensIn: 2000, tokensOut: 200, costUsd: .003 });
});
it('refuses before starting a new call and marks failed', async () => {
  const { opts, store, create } = setup([response()]);
  vi.stubEnv('WAYFINDER_CASE_BUDGET_USD', '0');
  await expect(runAgent(opts)).rejects.toThrow('budget_exceeded');
  expect(create).not.toHaveBeenCalled();
  expect((await store.listByCase('c'))[0]).toMatchObject({ status: 'failed', error: 'budget_exceeded' });
});
it('checks the case budget again before validation retry', async () => {
  const { opts, store, create } = setup([response('invalid', 4_000_000), response()]);
  await expect(runAgent(opts)).rejects.toThrow('budget_exceeded');
  expect(create).toHaveBeenCalledTimes(1);
  expect((await store.listByCase('c'))[0]).toMatchObject({ tokensIn: 4_000_000, status: 'failed' });
});
it('offline replay costs zero even with budget zero', async () => {
  const { opts, store, create } = setup([]);
  vi.stubEnv('WAYFINDER_OFFLINE', '1'); vi.stubEnv('WAYFINDER_CASE_BUDGET_USD', '0');
  await runAgent({ ...opts, output: z.unknown() });
  expect(create).not.toHaveBeenCalled();
  expect((await store.listByCase('c'))[0]).toMatchObject(emptyUsage());
});
it('unknown model is successful with null cost', async () => {
  const { opts, store } = setup([{ ...response(), model: 'future-model' }]);
  await runAgent({ ...opts, model: 'future-model' });
  expect((await store.listByCase('c'))[0]).toMatchObject({ status: 'done', tokensIn: 1000, costUsd: null });
});
it('includes previous agents when enforcing the case budget', async () => {
  const { opts, store, create } = setup([response()]);
  const previous = await store.create('c', 'literature');
  await store.update(previous, { status: 'done', costUsd: 3 });
  await expect(runAgent(opts)).rejects.toThrow('budget_exceeded');
  expect(create).not.toHaveBeenCalled();
});
it('accounts for tool turns and final responses', async () => {
  const { opts, store } = setup([
    { ...response(), stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'lookup', input: {} } as Anthropic.ToolUseBlock] },
    response(),
  ]);
  await runAgent({ ...opts, tools: [{ name: 'lookup', description: '', inputSchema: z.object({}), handler: async () => ({ found: true }) }] });
  expect((await store.listByCase('c'))[0]).toMatchObject({ tokensIn: 2000, tokensOut: 200, costUsd: .003 });
});
