import { modelFor, type ModelRole } from '@/config/models';
import { createClaudeClient, directAnthropicKey, gatewayConfig, messageText } from './gateway';

export async function chat({ role, messages, signal }: {
  role: Exclude<ModelRole, 'embedding'>;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
}): Promise<string> {
  if (directAnthropicKey()) return chatDirect(role, messages, signal);
  const gateway = gatewayConfig();
  if (!gateway) throw new Error('AI gateway is not configured');
  const response = await fetch(`${gateway.base}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${gateway.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelFor(role), messages }), signal: signal ?? AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AI chat request failed (${response.status})`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Invalid AI chat response');
  return content;
}

/** Same contract through the account's Anthropic key: system turns become the system prompt. */
async function chatDirect(
  role: Exclude<ModelRole, 'embedding'>,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal,
): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'system');
  const response = await createClaudeClient().messages.create(
    { model: modelFor(role), max_tokens: 4096, ...(system ? { system } : {}), messages: turns },
    { signal: signal ?? AbortSignal.timeout(60_000) },
  );
  return messageText(response);
}
