import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOrigin, rejectCrossOrigin } from "../../lib/auth/origin";
import { ensureSession, readSession, sessionCookie, signSession, verifySessionValue } from "../../lib/auth/session";

const env = { WAYFINDER_SESSION_SECRET: "s3cret-one" };
const reqWith = (cookie?: string) => new Request("http://localhost/x", { headers: cookie ? { cookie } : {} });

afterEach(() => vi.restoreAllMocks());

describe("session", () => {
  it("signs and verifies", () => {
    const v = signSession("abc", env);
    expect(verifySessionValue(v, env)).toBe("abc");
    expect(readSession(reqWith(`a=b; wf_session=${v}`), env)).toBe("abc");
  });
  it("rejects tampering and wrong secret", () => {
    const v = signSession("abc", env);
    expect(verifySessionValue(v.replace("abc", "abd"), env)).toBeNull();
    expect(verifySessionValue(v + "x", env)).toBeNull();
    expect(verifySessionValue(v, { WAYFINDER_SESSION_SECRET: "other" })).toBeNull();
    expect(verifySessionValue("nodot", env)).toBeNull();
    expect(readSession(reqWith(), env)).toBeNull();
  });
  it("ensureSession creates a cookie only when needed", () => {
    const s = ensureSession(reqWith(), env);
    expect(s.setCookie).toContain("wf_session=");
    expect(s.id.length).toBeGreaterThanOrEqual(43);
    const again = ensureSession(reqWith(s.setCookie!.split(";")[0]), env);
    expect(again.id).toBe(s.id);
    expect(again.setCookie).toBeUndefined();
    expect(ensureSession(reqWith("wf_session=bad.sig"), env).setCookie).toBeDefined();
  });
  it("cookie attributes", () => {
    const dev = sessionCookie("abc", env);
    for (const a of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) expect(dev).toContain(a);
    expect(dev).not.toContain("Secure");
    expect(sessionCookie("abc", { ...env, NODE_ENV: "production" })).toContain("Secure");
  });
  it("throws without a secret in production, warns at most once in dev", () => {
    expect(() => signSession("a", { NODE_ENV: "production" })).toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    signSession("a", {});
    signSession("a", {});
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("origin", () => {
  const post = (headers: Record<string, string>, url = "http://app.test/api/x") => new Request(url, { method: "POST", headers });
  it("accepts matching Origin and Referer fallback", () => {
    expect(isSameOrigin(post({ origin: "http://app.test" }), {})).toBe(true);
    expect(isSameOrigin(post({ referer: "http://app.test/page?q=1" }), {})).toBe(true);
  });
  it("rejects missing or foreign origin", () => {
    expect(isSameOrigin(post({}), {})).toBe(false);
    expect(isSameOrigin(post({ origin: "http://evil.test" }), {})).toBe(false);
    expect(isSameOrigin(post({ origin: "null" }), {})).toBe(false);
    expect(rejectCrossOrigin(post({}), {})?.status).toBe(403);
    expect(rejectCrossOrigin(post({ origin: "http://app.test" }), {})).toBeNull();
  });
  it("honours forwarded host and configured origin", () => {
    const fwd = post({ origin: "https://public.test", "x-forwarded-host": "public.test", "x-forwarded-proto": "https" });
    expect(isSameOrigin(fwd, {})).toBe(true);
    expect(isSameOrigin(post({ origin: "https://public.test" }), { WAYFINDER_APP_ORIGIN: "https://public.test" })).toBe(true);
    expect(isSameOrigin(post({ origin: "http://app.test" }), { WAYFINDER_APP_ORIGIN: "https://public.test" })).toBe(false);
  });
  it("exempts safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(isSameOrigin(new Request("http://app.test/", { method }), {})).toBe(true);
  });
});
