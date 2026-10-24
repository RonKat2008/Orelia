import { gatewayConfig } from '@/lib/ai/gateway';

export const ROLES = ['orchestrator', 'intake', 'verifier', 'inbox', 'curator', 'research', 'form', 'embedding'] as const;
export type ModelRole = typeof ROLES[number];
export type ModelId = string;
export function modelFor(role: ModelRole): ModelId {
  const override = process.env[`WAYFINDER_MODEL_${role.toUpperCase()}`]?.trim();
  if (override) return override;
  if (role === 'embedding') return 'qwen3-embedding-0-6b';
  if (role === 'research') return gatewayConfig() ? 'claude-haiku-4-5' : 'claude-haiku-5-5';
  return 'claude-opus-5-5';
}
/** Compatibility exports for existing agents. New callers should select a role. */
export const OPUS = modelFor('orchestrator');
export const HAIKU = modelFor('research');
export const MODELS = Object.fromEntries(ROLES.map(role => [role, modelFor(role)])) as Record<ModelRole, string>;
