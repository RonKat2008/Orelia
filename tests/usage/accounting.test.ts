import { describe, it, expect } from 'vitest';
import { priceUsage, emptyUsage, addUsage, summarizeUsage, caseBudget } from '@/lib/ai/usage';

describe('usage accounting', () => {
  it('prices uncached, output, cache read and creation independently', () => {
    expect(priceUsage('claude-haiku-4-5', { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 4000 })).toEqual({ tokensIn: 1000, tokensOut: 200, cacheRead: 3000, cacheCreation: 4000, costUsd: 0.0073 });
  });
  it('unknown models retain tokens with unknown cost', () => {
    expect(priceUsage('future-model', { input_tokens: 17 }).costUsd).toBeNull();
    expect(addUsage(emptyUsage(), priceUsage('future-model', { input_tokens: 17 })).tokensIn).toBe(17);
  });
  it('keeps unknown costs visible in summaries and exposes no run content', () => {
    const rows = [{ agent: 'a', ...emptyUsage(), costUsd: 2, error: 'private' }, { agent: 'a', ...emptyUsage(), costUsd: null }];
    const result = summarizeUsage(rows);
    expect(result.totals.costUsd).toBeNull();
    expect(result.totals.knownCostUsd).toBe(2);
    expect(result.agents[0].runs).toBe(2);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('defaults invalid budgets and accepts zero', () => {
    expect(caseBudget(undefined)).toBe(3); expect(caseBudget('no')).toBe(3);
    expect(caseBudget('-1')).toBe(3); expect(caseBudget('0')).toBe(0);
  });
});
