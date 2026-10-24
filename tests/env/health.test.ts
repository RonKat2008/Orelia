import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthReport } from "@/app/api/health/_lib/health";

const SECRET_DB = "postgres://user:s3cr3t-pw-XYZ@db.example.test/neon";
const SECRET_KEY = "sk-distinctive-secret-9876";

const devSource = { DATABASE_URL: SECRET_DB, ANTHROPIC_API_KEY: SECRET_KEY };
const prodComplete = {
  VERCEL_ENV: "production",
  DATABASE_URL: SECRET_DB,
  ANTHROPIC_API_KEY: SECRET_KEY,
  INNGEST_EVENT_KEY: "evt-secret-111",
  INNGEST_SIGNING_KEY: "sig-secret-222",
  WAYFINDER_SESSION_SECRET: "sess-secret-333",
  OUTBOUND_ALLOWLIST: "allowed@example.test",
  AGENTMAIL_WEBHOOK_SECRET: "am-secret-444",
  AGENTCALL_WEBHOOK_SECRET: "ac-secret-555",
  EXA_API_KEY: "exa-secret-666",
};

describe("healthReport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports db up", async () => {
    const r = await healthReport({ source: devSource, pingDb: async () => {} });
    expect(r.db).toBe("up");
    expect(r.ok).toBe(true);
    expect(r.env).toEqual({ ok: true, missing: [] });
    expect(r.modelAccess).toBe("anthropic");
  });

  it("reports db down when ping throws, without leaking the error", async () => {
    const r = await healthReport({
      source: devSource,
      pingDb: async () => {
        throw new Error(`connect failed ${SECRET_DB}`);
      },
    });
    expect(r.db).toBe("down");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("s3cr3t");
  });

  it("reports db down when ping never resolves (timeout)", async () => {
    const p = healthReport({ source: devSource, pingDb: () => new Promise<void>(() => {}), timeoutMs: 1500 });
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect(r.db).toBe("down");
    expect(r.ok).toBe(false);
  });

  it("does not ping and reports not_configured without DATABASE_URL", async () => {
    const pingDb = vi.fn(async () => {});
    const r = await healthReport({ source: {}, pingDb });
    expect(r.db).toBe("not_configured");
    expect(r.ok).toBe(true);
    expect(pingDb).not.toHaveBeenCalled();
  });

  it("is not ok in prod mode with missing env, listing names only", async () => {
    const r = await healthReport({ source: { VERCEL_ENV: "production" }, pingDb: async () => {} });
    expect(r.mode).toBe("prod");
    expect(r.ok).toBe(false);
    expect(r.env.ok).toBe(false);
    expect(r.env.missing).toContain("DATABASE_URL");
  });

  it("is ok in prod with everything set, includes short version, and leaks no values", async () => {
    const r = await healthReport({
      source: { ...prodComplete, VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" },
      pingDb: async () => {},
    });
    expect(r.ok).toBe(true);
    expect(r.version).toBe("abcdef1");
    const body = JSON.stringify(r);
    for (const v of Object.values(prodComplete)) {
      if (v !== "production") expect(body).not.toContain(v);
    }
  });
});

describe("GET /api/health", () => {
  it("sets no-store and returns 200 in offline mode without a DB", async () => {
    vi.resetModules();
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    vi.stubEnv("DATABASE_URL", "");
    const { GET, dynamic } = await import("@/app/api/health/route");
    const res = await GET();
    vi.unstubAllEnvs();
    expect(dynamic).toBe("force-dynamic");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("offline");
    expect(body.db).toBe("not_configured");
  });

  it("returns 503 in prod mode with missing env", async () => {
    vi.resetModules();
    vi.stubEnv("WAYFINDER_MODE", "prod");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("WAYFINDER_OFFLINE", "");
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    vi.unstubAllEnvs();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is degraded (still ok) in prod when only Inngest is unconfigured", async () => {
    const { INNGEST_EVENT_KEY: _a, INNGEST_SIGNING_KEY: _b, ...noInngest } = prodComplete;
    const r = await healthReport({ source: noInngest, pingDb: async () => {} });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("degraded");
    expect(r.inngest).toBe("unconfigured");
    expect(r.scheduler).toBe("none");
    expect(r.env.missing).toEqual([]);
  });

  it("is ok with the cron scheduler when Inngest is absent but CRON_SECRET is set", async () => {
    const { INNGEST_EVENT_KEY: _a, INNGEST_SIGNING_KEY: _b, ...noInngest } = prodComplete;
    const r = await healthReport({ source: { ...noInngest, CRON_SECRET: "x" }, pingDb: async () => {} });
    expect(r.status).toBe("ok");
    expect(r.scheduler).toBe("cron");
    expect(JSON.stringify(r)).not.toContain('"x"');
  });

  it("is ok with Inngest configured and down when a webhook secret is missing", async () => {
    expect((await healthReport({ source: prodComplete, pingDb: async () => {} })).status).toBe("ok");
    const { AGENTMAIL_WEBHOOK_SECRET: _w, ...noSecret } = prodComplete;
    const r = await healthReport({ source: noSecret, pingDb: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("down");
  });
});
