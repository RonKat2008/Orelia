import { describe, expect, it } from "vitest";
import { main } from "@/scripts/check-env";

const V = "SECRET-VALUE-123";
function run(argv: string[], source: Record<string, string | undefined>) {
  const lines: string[] = [];
  const code = main(argv, source, (l) => lines.push(l));
  return { code, out: lines.join("\n") };
}

describe("check-env main", () => {
  it("exits 0 when required vars are missing without --strict", () => {
    const { code, out } = run(["--mode", "prod"], { DATABASE_URL: V });
    expect(code).toBe(0);
    expect(out).toContain("Mode: prod");
    expect(out).toMatch(/✗ missing\s+AGENTMAIL_WEBHOOK_SECRET/);
    expect(out).toMatch(/✓ set\s+DATABASE_URL/);
  });

  it("exits 1 with --strict when something is missing", () => {
    expect(run(["--mode", "prod", "--strict"], {}).code).toBe(1);
    expect(run(["--mode=demo", "--strict"], {}).code).toBe(1);
  });

  it("exits 0 with --strict when satisfied or nothing required", () => {
    expect(run(["--strict", "--mode", "dev"], {}).code).toBe(0);
    expect(run(["--strict"], { WAYFINDER_OFFLINE: "1" }).code).toBe(0);
    const ok = {
      DATABASE_URL: V, ANTHROPIC_API_KEY: V, INNGEST_EVENT_KEY: V, INNGEST_SIGNING_KEY: V,
      OUTBOUND_ALLOWLIST: V, WAYFINDER_SESSION_SECRET: V, AGENTMAIL_WEBHOOK_SECRET: V,
      AGENTCALL_WEBHOOK_SECRET: V, EXA_API_KEY: V,
    };
    const r = run(["--strict", "--mode", "prod"], ok);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Result: ok");
  });

  it("resolves mode from env when --mode is absent", () => {
    expect(run([], { VERCEL_ENV: "production" }).out).toContain("Mode: prod");
  });

  it("rejects an invalid mode", () => {
    expect(run(["--mode", "staging"], {}).code).toBe(2);
  });

  it("never prints values", () => {
    const { out } = run(["--mode", "prod", "--strict"], {
      DATABASE_URL: V, OUTBOUND_ALLOW_REAL: V, NEON_AI_GATEWAY_TOKEN: V, WAYFINDER_SIM_TIME_SCALE: V,
    });
    expect(out).not.toContain(V);
    expect(out).toMatch(/Warnings:/);
    expect(out).toContain("Set: ");
  });
});
