import { afterEach, describe, expect, it, vi } from "vitest";
import config from "@/vercel";

const mocks = vi.hoisted(() => ({ sweep: vi.fn(), services: vi.fn() }));
vi.mock("@/lib/workflows/research-watchdog", () => ({ sweepStuckResearch: mocks.sweep }));
vi.mock("@/lib/workflows/researching-cases", () => ({ listResearchingCaseIds: vi.fn() }));
vi.mock("@/app/api/cases/_lib/services", () => ({ getServices: mocks.services }));
import { GET } from "@/app/api/cron/research-watchdog/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const call = (auth?: string) => GET(new Request("http://x", { headers: auth ? { authorization: auth } : {} }));

describe("GET /api/cron/research-watchdog", () => {
  it("fails closed without CRON_SECRET or with a wrong bearer", async () => {
    expect((await call("Bearer x")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it("sweeps when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("DATABASE_URL", "postgres://synthetic");
    mocks.services.mockReturnValue({ cases: {}, runs: {} });
    mocks.sweep.mockResolvedValue({ checked: 2, reaped: ["a"] });
    const res = await call("Bearer s3cret");
    expect(await res.json()).toEqual({ ok: true, checked: 2, reaped: ["a"] });
  });

  it("is scheduled in vercel.ts with a duration entry", () => {
    expect(config.crons?.some((c) => c.path === "/api/cron/research-watchdog")).toBe(true);
    expect(config.functions?.["app/api/cron/research-watchdog/route.ts"]).toEqual({ maxDuration: 60 });
  });
});
