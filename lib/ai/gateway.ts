import Anthropic from '@anthropic-ai/sdk';

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
  const gateway = gatewayConfig();
  return gateway
    ? new Anthropic({ apiKey: null, authToken: gateway.token, baseURL: `${gateway.base}/anthropic`, ...CLIENT_LIMITS })
    : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...CLIENT_LIMITS });
}

export function hasClaudeCredentials() {
  return Boolean(gatewayConfig() || process.env.ANTHROPIC_API_KEY);
}
