import { directAnthropicKey, gatewayConfig } from '@/lib/ai/gateway';

export const ROLES = ['orchestrator', 'intake', 'verifier', 'inbox', 'curator', 'needs', 'judge', 'research', 'form', 'history', 'verification', 'embedding'] as const;
export type ModelRole = typeof ROLES[number];
export type ModelId = string;
export function modelFor(role: ModelRole): ModelId {
  const override = process.env[`WAYFINDER_MODEL_${role.toUpperCase()}`]?.trim();
  // Every language model is Claude: an override may only pick another Claude model (the embedding index excepted).
  if (override && (role === 'embedding' || override.startsWith('claude-'))) return override;
  if (role === 'embedding') return 'qwen3-embedding-0-6b';
  // The gateway lists Haiku 4.5; the account's own key reaches Haiku 5.5.
  if (role === 'research') return gatewayConfig() && !directAnthropicKey() ? 'claude-haiku-4-5' : 'claude-haiku-5-5';
  // Mid tier: the needs analyst must be fast. The judge stays on the top tier (judge >= generator).
  if (role === 'needs') return 'claude-sonnet-5-5';
  return 'claude-opus-5-5';
}
/** Compatibility exports for existing agents. New callers should select a role. */
export const OPUS = modelFor('orchestrator');
export const HAIKU = modelFor('research');
export const MODELS = Object.fromEntries(ROLES.map(role => [role, modelFor(role)])) as Record<ModelRole, string>;

/** Claude 5-family models reject `temperature` ("deprecated for this model"); stability there comes from code. */
export function acceptsTemperature(model: ModelId): boolean {
  return !/^claude-(opus|sonnet|haiku)-5\b/.test(model);
}
