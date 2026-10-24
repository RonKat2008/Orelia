import { AsyncLocalStorage } from 'node:async_hooks';
import { modelPrice } from '@/config/pricing';

export interface Usage { tokensIn: number; tokensOut: number; cacheRead: number; cacheCreation: number; costUsd: number | null }
export interface ProviderUsage {
  input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
  prompt_tokens?: number | null; total_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null;
}
export const emptyUsage = (): Usage => ({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0 });
const tokens = (n: number | null | undefined) => Number.isFinite(n) && n! > 0 ? Math.floor(n!) : 0;
export function priceUsage(model: string, value: ProviderUsage): Usage {
  const usage = { tokensIn: tokens(value.input_tokens ?? value.prompt_tokens ?? value.total_tokens), tokensOut: tokens(value.output_tokens), cacheRead: tokens(value.cache_read_input_tokens), cacheCreation: tokens(value.cache_creation_input_tokens), costUsd: null as number | null };
  const p = modelPrice(model, usage.tokensIn + usage.cacheRead + usage.cacheCreation);
  const hour = Math.min(usage.cacheCreation, tokens(value.cache_creation?.ephemeral_1h_input_tokens));
  if (p) usage.costUsd = (usage.tokensIn * p.input + usage.tokensOut * p.output + usage.cacheRead * p.cacheRead + (usage.cacheCreation - hour) * p.cacheWrite + hour * p.cacheWriteHour) / 1e6;
  return usage;
}
export function addUsage(a: Usage, b: Usage): Usage {
  return { tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut, cacheRead: a.cacheRead + b.cacheRead, cacheCreation: a.cacheCreation + b.cacheCreation, costUsd: a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd };
}
export function caseBudget(raw = process.env.WAYFINDER_CASE_BUDGET_USD): number {
  const n = raw?.trim() ? Number(raw) : 3;
  return Number.isFinite(n) && n >= 0 ? n : 3;
}
export class BudgetExceededError extends Error { constructor() { super('budget_exceeded'); this.name = 'BudgetExceededError'; } }
export function summarizeUsage(rows: Array<{ agent: string } & Partial<Usage>>) {
  const agents = new Map<string, ReturnType<typeof bucket>>();
  function bucket(agent: string) { return { agent, ...emptyUsage(), knownCostUsd: 0, unknownCostRuns: 0, runs: 0 }; }
  const totals = bucket('total');
  for (const row of rows) {
    const group = agents.get(row.agent) ?? bucket(row.agent);
    agents.set(row.agent, group);
    for (const target of [totals, group]) {
      const usage = { ...emptyUsage(), ...row, costUsd: row.costUsd ?? null };
      Object.assign(target, addUsage(target, usage));
      target.runs++; target.knownCostUsd += row.costUsd ?? 0;
      if (row.costUsd == null) target.unknownCostRuns++;
    }
  }
  return { totals, agents: [...agents.values()].sort((a, b) => a.agent.localeCompare(b.agent)) };
}
/** Propagates accounting through tool calls without putting prompts/content in the ledger. */
export const usageContext = new AsyncLocalStorage<{ capture(model: string, usage: ProviderUsage): Promise<void>; beforeCall(): Promise<void> }>();
export async function captureEmbeddingUsage(model: string, usage: ProviderUsage) { await usageContext.getStore()?.capture(model, usage); }
