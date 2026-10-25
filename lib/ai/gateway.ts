import Anthropic from '@anthropic-ai/sdk';

/** The account's own Anthropic API key. When set, every Claude call goes straight to Anthropic with it. */
export function directAnthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

/** Neon AI Gateway: used for Claude only when no direct key is set, and always for embeddings (Claude has none). */
export function gatewayConfig() {
  const base = process.env.NEON_AI_GATEWAY_BASE_URL?.replace(/\/+$/, '');
  const token = process.env.NEON_AI_GATEWAY_TOKEN;
  return base && token ? { base, token } : undefined;
}

/**
 * The SDK default is a 10 minute timeout with 2 retries, far past the 120-300s function limits. Cap each attempt and
 * retry once, so a stalled gateway fails the run with a message instead of the platform killing the function.
 */
export const MODEL_CALL_TIMEOUT_MS = 100_000;
const CLIENT_LIMITS = { timeout: MODEL_CALL_TIMEOUT_MS, maxRetries: 1 } as const;

export function createClaudeClient() {
  const key = directAnthropicKey();
  const gateway = gatewayConfig();
  if (key || !gateway) return new Anthropic({ apiKey: key, ...CLIENT_LIMITS });
  return new Anthropic({ apiKey: null, authToken: gateway.token, baseURL: `${gateway.base}/anthropic`, ...CLIENT_LIMITS });
}

export function hasClaudeCredentials() {
  return Boolean(directAnthropicKey() || gatewayConfig());
}

/** Text of a Messages API response (concatenated text blocks). */
export function messageText(message: { content: { type: string; text?: string }[] }): string {
  return message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
}
