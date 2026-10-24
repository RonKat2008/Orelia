import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  MemoryRateLimitStore, PostgresRateLimitStore, checkRateLimit, MODEL_CALL_LIMITS, RESEARCH_LIMITS,
  rateLimitedResponse, withModelRateLimit, RateLimitedError,
} from "../../lib/rate-limit";

const t0 = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 3600_000;

describe("memory store / checkRateLimit", () => {
  it("counts within a window and rolls over after it", async () => {
    const s = new MemoryRateLimitStore();
    const rules = [{ key: "k", max: 2, windowMs: 1000 }];
    expect((await checkRateLimit(s, rules, t0)).ok).toBe(true);
    expect((await checkRateLimit(s, rules, at(10))).ok).toBe(true);
    expect((await checkRateLimit(s, rules, at(20))).ok).toBe(false);
    expect((await checkRateLimit(s, rules, at(1000))).ok).toBe(true);
    expect(await s.hit("k", 1000, at(1001))).toBe(2);
  });
  it("evaluates multiple rules and reports the longest retry-after", async () => {
    const s = new MemoryRateLimitStore();
    const rules = [{ key: "a", max: 1, windowMs: 60_000 }, { key: "b", max: 1, windowMs: 3_600_000 }];
    expect((await checkRateLimit(s, rules, t0)).ok).toBe(true);
    expect(await checkRateLimit(s, rules, at(1))).toEqual({ ok: false, retryAfterSeconds: 3600 });
    expect(await checkRateLimit(s, [{ key: "c", max: 0, windowMs: 1500 }], t0)).toEqual({ ok: false, retryAfterSeconds: 2 });
  });
  it("is atomic under concurrency", async () => {
    const s = new MemoryRateLimitStore();
    const results = await Promise.all(Array.from({ length: 50 }, () => checkRateLimit(s, [{ key: "x", max: 10, windowMs: 1000 }], t0)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
  });
});

describe("presets", () => {
  it("has the documented numbers", () => {
    expect(RESEARCH_LIMITS("c", "s")).toEqual([
      { key: "research:case:c", max: 3, windowMs: HOUR },
      { key: "research:session:s", max: 10, windowMs: HOUR },
    ]);
    expect(MODEL_CALL_LIMITS("inbox", "c")).toEqual([{ key: "model:inbox:case:c", max: 60, windowMs: HOUR }]);
  });
  it("builds a 429 response with Retry-After", async () => {
    const res = rateLimitedResponse(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(await res.json()).toEqual({ error: "Too many requests" });
  });
  it("withModelRateLimit throws before calling fn when over limit", async () => {
    const s = new MemoryRateLimitStore();
    let calls = 0;
    const fn = async () => { calls++; };
    for (let i = 0; i < 60; i++) await withModelRateLimit("curator", "c", fn, s, t0);
    await expect(withModelRateLimit("curator", "c", fn, s, t0)).rejects.toBeInstanceOf(RateLimitedError);
    expect(calls).toBe(60);
    await withModelRateLimit("inbox", "c", fn, s, t0);
    expect(calls).toBe(61);
  });
});

describe("PostgresRateLimitStore", () => {
  it("issues one parameterized atomic upsert", async () => {
    const seen: unknown[] = [];
    const store = new PostgresRateLimitStore({ execute: async (q) => { seen.push(q); return { rows: [{ count: "3" }] }; } });
    const evil = "research:case:x'; DROP TABLE y;--";
    expect(await store.hit(evil, HOUR, t0)).toBe(3);
    expect(seen).toHaveLength(1);
    const q = new PgDialect().sqlToQuery(seen[0] as never);
    expect(q.sql).toMatch(/INSERT INTO rate_limits/);
    expect(q.sql).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(q.sql).toMatch(/RETURNING count/);
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toContain(evil);
    expect(q.params).toContain(HOUR);
  });
  it("throws when no row is returned", async () => {
    await expect(new PostgresRateLimitStore({ execute: async () => ({ rows: [] }) }).hit("k", 1, t0)).rejects.toThrow();
  });
});
