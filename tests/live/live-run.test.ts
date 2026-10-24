import { describe, expect, it } from "vitest";
import { agentFromSystem, classifyApiBody, estimateUsd, tally, type TokenUsage } from "../../scripts/live-run";

const usage: TokenUsage = { input: 1_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 };

describe("live-run accounting", () => {
  it("attributes a system prompt to an agent and prices Haiku list rates", () => {
    expect(agentFromSystem([{ type: "text", text: "ROLE: Trials agent. List recruiting" }])).toBe("trials");
    expect(estimateUsd("claude-haiku-4-5", usage)).toMatchObject({ usd: 6, priced: true });
  });

  it("sums token events per agent and flags API drift", () => {
    const rows = tally([
      { agent: "literature", model: "claude-haiku-4-5", usage: { input: 10, output: 2, cacheWrite: 0, cacheRead: 0 } },
      { agent: "literature", model: "claude-haiku-4-5", usage: { input: 5, output: 1, cacheWrite: 0, cacheRead: 0 } },
    ]);
    expect(rows).toEqual([
      { agent: "literature", model: "claude-haiku-4-5", calls: 2, usage: { input: 15, output: 3, cacheWrite: 0, cacheRead: 0 } },
    ]);
    const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    expect(classifyApiBody(url, 200, { error: "API rate limit exceeded" }, "application/json")?.detail).toMatch(/NCBI error/);
    expect(classifyApiBody(url, 200, { esearchresult: { count: "0" } }, "application/json")).toBeUndefined();
  });
});

describe.skipIf(process.env.WAYFINDER_LIVE !== "1")("live gateway", () => {
  it("is invoked by scripts/live-run.ts, not this unit file", () => {
    expect(process.env.WAYFINDER_LIVE).toBe("1");
  });
});
