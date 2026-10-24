import Anthropic from '@anthropic-ai/sdk';

export function gatewayConfig() {
  const base = process.env.NEON_AI_GATEWAY_BASE_URL?.replace(/\/+$/, '');
  const token = process.env.NEON_AI_GATEWAY_TOKEN;
  return base && token ? { base, token } : undefined;
}

export function createClaudeClient() {
  const gateway = gatewayConfig();
  return gateway
    ? new Anthropic({ apiKey: null, authToken: gateway.token, baseURL: `${gateway.base}/anthropic` })
    : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export function hasClaudeCredentials() {
  return Boolean(gatewayConfig() || process.env.ANTHROPIC_API_KEY);
}
