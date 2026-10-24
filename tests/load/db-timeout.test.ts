import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "@/db/client";

afterEach(() => vi.unstubAllGlobals());

it("gives every database HTTP call an abort signal so a stalled Neon endpoint fails instead of hanging", async () => {
  const seen: (AbortSignal | null | undefined)[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    seen.push(init?.signal);
    return new Response(JSON.stringify({ rows: [], fields: [], rowCount: 0, command: "SELECT" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  await createDb("postgresql://u:p@ep-synthetic.invalid/db").execute(sql`SELECT 1`).catch(() => undefined);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((s) => s instanceof AbortSignal)).toBe(true);
});
