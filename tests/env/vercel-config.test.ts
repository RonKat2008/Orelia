import { describe, expect, it } from "vitest";
import config, { contentSecurityPolicy } from "@/vercel";

function directive(name: string): string {
  const d = contentSecurityPolicy.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name} `) || s === name);
  if (!d) throw new Error(`missing directive ${name}`);
  return d;
}

describe("vercel.ts", () => {
  it("targets nextjs", () => {
    expect(config.framework).toBe("nextjs");
  });

  it("sets maxDuration for long-running routes", () => {
    expect(config.functions?.["app/api/inngest/route.ts"]?.maxDuration).toBe(300);
    expect(config.functions?.["app/api/cases/[id]/stream/route.ts"]?.maxDuration).toBe(300);
    expect(config.functions?.["app/api/cases/[id]/research/route.ts"]?.maxDuration).toBe(300);
  });

  it("applies every security header to all routes", () => {
    const rule = config.headers?.find((h) => h.source === "/(.*)");
    const keys = (rule?.headers ?? []).map((h) => h.key);
    for (const k of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(keys).toContain(k);
    }
    const get = (k: string) => rule?.headers.find((h) => h.key === k)?.value;
    expect(get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("has a restrictive CSP with no server-only origins in connect-src", () => {
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy).not.toContain("unsafe-eval");
    // Only exception: path-scoped private Vercel Blob client uploads (document library).
    expect(directive("connect-src")).toBe("connect-src 'self' https://vercel.com/api/blob/");
    expect(contentSecurityPolicy).not.toMatch(/neon|exa\.ai|agentmail|agentcall|ncbi|clinicaltrials/i);
  });

  it("does not redirect or rewrite webhook and inngest routes", () => {
    expect(config.redirects ?? []).toEqual([]);
    expect(config.rewrites ?? []).toEqual([]);
  });

  it("runs the strict env check for production builds before next build", () => {
    const cmd = config.buildCommand ?? "";
    expect(cmd).toContain('"$VERCEL_ENV" = "production"');
    expect(cmd).toContain("scripts/check-env.ts --strict");
    expect(cmd.endsWith("&& next build")).toBe(true);
  });
});
