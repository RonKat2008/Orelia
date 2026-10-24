/** USD per million tokens, standard global inference. Edit here when provider rates change.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-23).
 * Gateway embedding prices are deployment-specific: absent prices remain unknown.
 */
export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWriteHour: number }
export const PRICING: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: .2, cacheWrite: 5, cacheWriteHour: 8 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: .1, cacheWrite: 2.5, cacheWriteHour: 4 },
  'claude-haiku-5-5': { input: .1, output: .5, cacheRead: .01, cacheWrite: .125, cacheWriteHour: .2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: .1, cacheWrite: 1.25, cacheWriteHour: 2 },
};
export function modelPrice(model: string, promptTokens = 0): ModelPrice | undefined {
  const key = model.replace(/-\d{8}$/, '');
  const price = PRICING[key];
  return key === 'claude-haiku-5-5' && promptTokens > 100_000 && price
    ? Object.fromEntries(Object.entries(price).map(([k, v]) => [k, v * 5])) as unknown as ModelPrice
    : price;
}
