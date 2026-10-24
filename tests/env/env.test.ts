import { describe, expect, it } from "vitest";
import {
  assertEnv,
  checkEnv,
  deployStatus,
  EnvValidationError,
  isOffline,
  parseEnv,
  requirementsFor,
  resolveMode,
  type EnvMode,
} from "@/lib/env";

const V = "SECRET-VALUE-123";
const names = (mode: EnvMode, src: Record<string, string | undefined> = {}) =>
  requirementsFor(mode, src).map((r) => r.name);

const full = {
  DATABASE_URL: V,
  ANTHROPIC_API_KEY: V,
  INNGEST_EVENT_KEY: V,
  INNGEST_SIGNING_KEY: V,
  OUTBOUND_ALLOWLIST: V,
  WAYFINDER_SESSION_SECRET: V,
  AGENTMAIL_WEBHOOK_SECRET: V,
  AGENTCALL_WEBHOOK_SECRET: V,
  EXA_API_KEY: V,
};

describe("module import", () => {
  it("keeps legacy exports working and never throws on empty env", () => {
    expect(parseEnv({}).DATABASE_URL).toBeUndefined();
    expect(parseEnv({ DATABASE_URL: "" }).DATABASE_URL).toBeUndefined();
    expect(isOffline("1")).toBe(true);
    expect(isOffline("true")).toBe(true);
    expect(isOffline("0")).toBe(false);
    expect(parseEnv({ WAYFINDER_SESSION_SECRET: "x" }).WAYFINDER_SESSION_SECRET).toBe("x");
  });
});

describe("resolveMode", () => {
  it.each<[Record<string, string>, EnvMode]>([
    [{}, "dev"],
    [{ WAYFINDER_MODE: "demo" }, "demo"],
    [{ WAYFINDER_MODE: "bogus" }, "dev"],
    [{ WAYFINDER_MODE: "prod", WAYFINDER_OFFLINE: "1" }, "prod"],
    [{ WAYFINDER_OFFLINE: "1" }, "offline"],
    [{ WAYFINDER_OFFLINE: "true", VERCEL_ENV: "production" }, "offline"],
    [{ VERCEL_ENV: "production" }, "prod"],
    [{ VERCEL_ENV: "production", WAYFINDER_DEMO: "1" }, "prod"],
    [{ WAYFINDER_DEMO: "1" }, "demo"],
    [{ WAYFINDER_DEMO: "true", VERCEL_ENV: "preview" }, "demo"],
    [{ VERCEL_ENV: "preview" }, "dev"],
    [{ NODE_ENV: "production" }, "prod"],
    [{ NODE_ENV: "production", VERCEL_ENV: "preview" }, "dev"],
    [{ NODE_ENV: "production", WAYFINDER_DEMO: "1" }, "demo"],
    [{ NODE_ENV: "development" }, "dev"],
  ])("%j -> %s", (src, mode) => {
    expect(resolveMode(src)).toBe(mode);
  });
});

describe("requirementsFor", () => {
  it("offline and dev require nothing", () => {
    expect(names("offline")).toEqual([]);
    expect(names("dev")).toEqual([]);
  });

  it("demo base set", () => {
    expect(names("demo")).toEqual([
      "DATABASE_URL",
      "MODEL_ACCESS",
      "WAYFINDER_SESSION_SECRET",
      "OUTBOUND_ALLOWLIST",
    ]);
  });

  it("demo adds channel secrets only when the API key is set", () => {
    expect(names("demo", { AGENTMAIL_API_KEY: "a" })).toContain("AGENTMAIL_WEBHOOK_SECRET");
    expect(names("demo", {})).not.toContain("AGENTMAIL_WEBHOOK_SECRET");
    const call = names("demo", { AGENTCALL_API_KEY: "a" });
    expect(call).toContain("AGENTCALL_WEBHOOK_SECRET");
    expect(call).toContain("AGENTCALL_FROM_NUMBER_ID");
    expect(names("demo", {})).not.toContain("AGENTCALL_FROM_NUMBER_ID");
  });

  it("prod adds webhook secrets and EXA unconditionally", () => {
    const n = names("prod", {});
    for (const x of ["AGENTMAIL_WEBHOOK_SECRET", "AGENTCALL_WEBHOOK_SECRET", "EXA_API_KEY", "OUTBOUND_ALLOWLIST"]) {
      expect(n).toContain(x);
    }
  });

  it("allowlist waived only by OUTBOUND_ALLOW_REAL === 'true' in prod", () => {
    expect(names("prod", { OUTBOUND_ALLOW_REAL: "true" })).not.toContain("OUTBOUND_ALLOWLIST");
    expect(names("prod", { OUTBOUND_ALLOW_REAL: "TRUE" })).toContain("OUTBOUND_ALLOWLIST");
    expect(names("prod", { OUTBOUND_ALLOW_REAL: "1" })).toContain("OUTBOUND_ALLOWLIST");
    expect(names("demo", { OUTBOUND_ALLOW_REAL: "true" })).toContain("OUTBOUND_ALLOWLIST");
  });
});

describe("checkEnv model access", () => {
  const missingNames = (src: Record<string, string>) => checkEnv("demo", { ...full, ANTHROPIC_API_KEY: "", ...src }).missing.map((r) => r.name);

  it("one gateway var alone does not satisfy", () => {
    expect(missingNames({ NEON_AI_GATEWAY_BASE_URL: V })).toContain("MODEL_ACCESS");
    expect(missingNames({ NEON_AI_GATEWAY_TOKEN: V })).toContain("MODEL_ACCESS");
  });
  it("both gateway vars satisfy", () => {
    expect(missingNames({ NEON_AI_GATEWAY_BASE_URL: V, NEON_AI_GATEWAY_TOKEN: V })).not.toContain("MODEL_ACCESS");
  });
  it("anthropic key satisfies", () => {
    expect(checkEnv("demo", full).missing).toEqual([]);
  });
});

describe("assertEnv", () => {
  it("returns the report when ok", () => {
    expect(assertEnv("prod", full).ok).toBe(true);
    expect(assertEnv("dev", {}).ok).toBe(true);
  });

  it("throws with names only", () => {
    const src = { DATABASE_URL: V, EXA_API_KEY: V };
    let err: unknown;
    try {
      assertEnv("prod", src);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvValidationError);
    const e = err as EnvValidationError;
    expect(e.message).toMatch(/^Missing required environment variables for prod: .*AGENTMAIL_WEBHOOK_SECRET.* \(see docs\/DEPLOY\.md\)$/);
    expect(e.missing).toContain("AGENTMAIL_WEBHOOK_SECRET");
    expect(e.missing).not.toContain("INNGEST_SIGNING_KEY");
    expect(e.missing).not.toContain("DATABASE_URL");
    expect(e.message).not.toContain(V);
    expect(JSON.stringify(e.missing)).not.toContain(V);
  });

  it("report never contains values", () => {
    const r = checkEnv("prod", { ...full, OUTBOUND_ALLOW_REAL: V });
    expect(JSON.stringify(r)).not.toContain(V);
    expect(r.set).toContain("DATABASE_URL");
    expect(r.unset).toContain("NCBI_API_KEY");
  });
});

describe("warnings", () => {
  const w = (mode: EnvMode, src: Record<string, string>) => checkEnv(mode, src).warnings.join("\n");
  it("typo guard on OUTBOUND_ALLOW_REAL", () => {
    expect(w("prod", { ...full, OUTBOUND_ALLOW_REAL: "yes" })).toMatch(/other than 'true'/);
    expect(w("prod", { ...full, OUTBOUND_ALLOW_REAL: "" })).not.toMatch(/OUTBOUND_ALLOW_REAL/);
    expect(w("prod", { ...full, OUTBOUND_ALLOW_REAL: "true" })).not.toMatch(/OUTBOUND_ALLOW_REAL/);
  });
  it("real sends outside prod", () => {
    expect(w("demo", { ...full, OUTBOUND_ALLOW_REAL: "true" })).toMatch(/no effect outside prod/);
  });
  it("half-configured gateway", () => {
    expect(w("dev", { NEON_AI_GATEWAY_TOKEN: V })).toMatch(/Only one of/);
    expect(w("dev", { NEON_AI_GATEWAY_TOKEN: V })).not.toContain(V);
  });
  it("sim time scale in prod", () => {
    expect(w("prod", { ...full, WAYFINDER_SIM_TIME_SCALE: "60" })).toMatch(/SIM_TIME_SCALE/);
    expect(w("demo", { ...full, WAYFINDER_SIM_TIME_SCALE: "60" })).not.toMatch(/SIM_TIME_SCALE/);
  });
  it("dev warns about db and model, does not fail", () => {
    const r = checkEnv("dev", {});
    expect(r.ok).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/DATABASE_URL/);
    expect(r.warnings.join("\n")).toMatch(/model access/);
  });
});

describe("deployStatus", () => {
  it("reports model access and outbound", () => {
    expect(deployStatus({})).toEqual({ mode: "dev", gateway: "not", inngest: "unconfigured", outbound: "allowlist", modelAccess: "none" });
    const s = deployStatus({
      VERCEL_ENV: "production",
      OUTBOUND_ALLOW_REAL: "true",
      NEON_AI_GATEWAY_BASE_URL: V,
      NEON_AI_GATEWAY_TOKEN: V,
      INNGEST_EVENT_KEY: V,
      INNGEST_SIGNING_KEY: V,
    });
    expect(s).toEqual({ mode: "prod", gateway: "configured", inngest: "configured", outbound: "real", modelAccess: "gateway" });
    expect(deployStatus({ ANTHROPIC_API_KEY: V }).modelAccess).toBe("anthropic");
    expect(deployStatus({ OUTBOUND_ALLOW_REAL: "true", WAYFINDER_DEMO: "1" }).outbound).toBe("allowlist");
    expect(deployStatus({ NEON_AI_GATEWAY_BASE_URL: V }).gateway).toBe("not");
  });
});
