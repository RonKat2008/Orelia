import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeClient, hasClaudeCredentials } from '@/lib/ai/gateway';
import { modelFor } from '@/config/models';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function bothConfigured() {
  vi.stubEnv('NEON_AI_GATEWAY_BASE_URL', 'https://gateway.example/prefix');
  vi.stubEnv('NEON_AI_GATEWAY_TOKEN', 'gateway-token');
  vi.stubEnv('ANTHROPIC_API_KEY', 'account-key');
}

describe('the account Anthropic key', () => {
  it('wins over the gateway for Claude calls', () => {
    bothConfigured();
    const client = createClaudeClient();
    expect(client.apiKey).toBe('account-key');
    expect(client.baseURL).not.toContain('gateway.example');
    expect(hasClaudeCredentials()).toBe(true);
    expect(modelFor('research')).toBe('claude-haiku-5-5');
  });

  it('sends role chat to Anthropic, with system turns as the system prompt', async () => {
    bothConfigured();
    const request = vi.fn().mockResolvedValue(Response.json({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'direct result' }], usage: { input_tokens: 1, output_tokens: 1 },
    }));
    vi.stubGlobal('fetch', request);
    const { chat } = await import('@/lib/ai/chat');
    const out = await chat({ role: 'inbox', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hello' }] });
    expect(out).toBe('direct result');
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toContain('api.anthropic.com');
    const body = JSON.parse(init.body);
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.model).toMatch(/^claude-/);
  });
});
