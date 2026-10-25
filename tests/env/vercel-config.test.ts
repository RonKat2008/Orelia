import { describe, expect, it } from "vitest";
import config, { BROWSER_CALL_SOURCES, browserCallContentSecurityPolicy, contentSecurityPolicy, DEFAULT_HEADERS_SOURCE } from "@/vercel";
import { documentAllowsBrowserCall } from "@/lib/live/browser-call-scope";

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
    const rule = config.headers?.find((h) => h.source === DEFAULT_HEADERS_SOURCE);
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

  it("relaxes CSP and the microphone only on /demo and case pages (demo browser call; client nav keeps the first document's CSP)", () => {
    const re = new RegExp(`^${DEFAULT_HEADERS_SOURCE}$`);
    for (const p of ["/demo", "/cases/abc/live", "/cases/abc", "/cases/abc/outbox"]) {
      expect(re.test(p)).toBe(false);
      expect(documentAllowsBrowserCall(p)).toBe(true);
    }
    for (const p of ["/", "/start", "/demo/intake-form/x", "/cases", "/account", "/api/cases/abc/calls/live"]) {
      expect(re.test(p)).toBe(true);
      expect(documentAllowsBrowserCall(p)).toBe(false);
    }
    expect(BROWSER_CALL_SOURCES).toEqual(["/demo", "/cases/:path*"]);
    for (const source of BROWSER_CALL_SOURCES) expect(config.headers?.some((h) => h.source === source)).toBe(true);
    const live = config.headers?.find((h) => h.source === "/cases/:path*");
    const get = (k: string) => live?.headers.find((h) => h.key === k)?.value ?? "";
    expect(get("Permissions-Policy")).toContain("microphone=(self)");
    expect(get("Permissions-Policy")).toContain("camera=()");
    expect(get("Content-Security-Policy")).toBe(browserCallContentSecurityPolicy);
    expect(browserCallContentSecurityPolicy).toContain("frame-ancestors 'none'");
    // Only WebAssembly compilation (Daily's Krisp noise filter), never JS eval; blob: for its audio worklet.
    expect(browserCallContentSecurityPolicy).not.toContain("'unsafe-eval'");
    expect(browserCallContentSecurityPolicy).toMatch(/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https:\/\/c\.daily\.co blob:;/);
    expect(contentSecurityPolicy).not.toContain("wasm-unsafe-eval");
    expect(get("X-Frame-Options")).toBe("DENY");
  });
});
