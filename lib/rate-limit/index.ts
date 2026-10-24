import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { getDb } from "../../db/client";

/**
 * Local shape of the rate_limits table (part A adds the same table to db/schema.ts).
 * Kept here so lib/rate-limit has no hard dependency on that export.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export interface RateLimitStore {
  /** Atomically increments and returns the count in the current fixed window. */
  hit(key: string, windowMs: number, now: Date): Promise<number>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, { start: number; count: number }>();
  async hit(key: string, windowMs: number, now: Date): Promise<number> {
    const t = now.getTime();
    const e = this.entries.get(key);
    if (!e || e.start <= t - windowMs) {
      this.entries.set(key, { start: t, count: 1 });
      return 1;
    }
    e.count += 1;
    return e.count;
  }
}

type Executor = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly dbOverride?: Executor) {}
  async hit(key: string, windowMs: number, now: Date): Promise<number> {
    const db = this.dbOverride ?? getDb();
    const intervalMs = Math.max(1, Math.floor(windowMs));
    const ts = now.toISOString();
    const result = (await db.execute(sql`
      INSERT INTO rate_limits (key, window_start, count)
      VALUES (${key}, ${ts}::timestamptz, 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.window_start <= ${ts}::timestamptz - (${intervalMs} * interval '1 millisecond') THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE WHEN rate_limits.window_start <= ${ts}::timestamptz - (${intervalMs} * interval '1 millisecond') THEN ${ts}::timestamptz ELSE rate_limits.window_start END
      RETURNING count
    `)) as { rows?: { count: number | string }[] };
    const row = result.rows?.[0];
    if (!row) throw new Error("rate limit upsert returned no row");
    return Number(row.count);
  }
}

export interface RateRule { key: string; max: number; windowMs: number }
export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Hits every rule (so all counters advance); fails if any exceeds its max. */
export async function checkRateLimit(store: RateLimitStore, rules: RateRule[], now: Date = new Date()): Promise<RateLimitResult> {
  let retry = 0;
  let failed = false;
  for (const rule of rules) {
    const count = await store.hit(rule.key, rule.windowMs, now);
    if (count > rule.max) {
      failed = true;
      // Upper bound on when this fixed window resets.
      retry = Math.max(retry, Math.ceil(rule.windowMs / 1000));
    }
  }
  return failed ? { ok: false, retryAfterSeconds: retry } : { ok: true };
}

const HOUR_MS = 60 * 60 * 1000;
export const RESEARCH_LIMITS = (caseId: string, sessionId: string): RateRule[] => [
  { key: `research:case:${caseId}`, max: 3, windowMs: HOUR_MS },
  { key: `research:session:${sessionId}`, max: 10, windowMs: HOUR_MS },
];
/** Each condition brief rebuild fans out to several public APIs and one model call. */
export const CONDITION_BRIEF_LIMITS = (caseId: string, sessionId: string): RateRule[] => [
  { key: `condition-brief:case:${caseId}`, max: 6, windowMs: HOUR_MS },
  { key: `condition-brief:session:${sessionId}`, max: 20, windowMs: HOUR_MS },
];
/** Refresh research re-runs PubMed / NPPES / Exa lookups for an existing case (no models). */
export const REFRESH_RESEARCH_LIMITS = (caseId: string, sessionId: string): RateRule[] => [
  { key: `refresh-research:case:${caseId}`, max: 3, windowMs: HOUR_MS },
  { key: `refresh-research:session:${sessionId}`, max: 10, windowMs: HOUR_MS },
];
/**
 * The platform-provided client IP: request.ip when the runtime sets it, else Vercel's x-real-ip (set by the edge,
 * not the client). The client-controlled X-Forwarded-For is never used. Null when neither is present (local runs).
 */
export function clientIp(req: Request): string | null {
  const platform = (req as Request & { ip?: string }).ip?.trim();
  const ip = platform || req.headers.get("x-real-ip")?.trim();
  return ip ? ip.slice(0, 64) : null;
}
/**
 * Per-client caps for work that costs money. Session ids are free (dropping the cookie mints a new one, and each
 * new case has its own per-case budget), so per-session and per-case limits alone do not bound one client.
 * No rules when the platform gives no client IP.
 */
export const CREATE_CASE_IP_LIMITS = (ip: string | null): RateRule[] =>
  ip ? [{ key: `create-case:ip:${ip}`, max: 10, windowMs: HOUR_MS }] : [];
export const RESEARCH_IP_LIMITS = (ip: string | null): RateRule[] =>
  ip ? [{ key: `research:ip:${ip}`, max: 10, windowMs: HOUR_MS }] : [];
/** Deleting a case is rare and destructive: a small per-session budget stops a runaway script. */
export const DELETE_CASE_LIMITS = (sessionId: string): RateRule[] => [
  { key: `delete-case:session:${sessionId}`, max: 20, windowMs: HOUR_MS },
];
export const MODEL_CALL_LIMITS = (scope: "inbox" | "curator", caseId: string): RateRule[] => [
  { key: `model:${scope}:case:${caseId}`, max: 60, windowMs: HOUR_MS },
];

export function getRateLimitStore(): RateLimitStore {
  const g = globalThis as { __rateLimitStore?: RateLimitStore };
  g.__rateLimitStore ??= process.env.DATABASE_URL ? new PostgresRateLimitStore() : new MemoryRateLimitStore();
  return g.__rateLimitStore;
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
}

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests");
    this.name = "RateLimitedError";
  }
}

export async function withModelRateLimit<T>(
  scope: "inbox" | "curator",
  caseId: string,
  fn: () => Promise<T>,
  store: RateLimitStore = getRateLimitStore(),
  now: Date = new Date(),
): Promise<T> {
  const r = await checkRateLimit(store, MODEL_CALL_LIMITS(scope, caseId), now);
  if (!r.ok) throw new RateLimitedError(r.retryAfterSeconds);
  return fn();
}

/** Test-only: drops the process-wide store so in-memory counters start fresh. */
export function resetMemoryRateLimitStore(): void {
  delete (globalThis as { __rateLimitStore?: RateLimitStore }).__rateLimitStore;
}
