import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { DEFAULT_AUTH_SKIP_ROUTES, processAuthMiddleware } from "@neondatabase/auth/server";

const state = vi.hoisted(() => ({ enabled: true, getAuth: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/auth/neon", () => ({ accountsEnabled: () => state.enabled, getNeonAuth: state.getAuth }));
vi.mock("@/lib/coordination/consult", () => ({ getConsultService: () => ({ reviewView: state.review }) }));

import { config, proxy } from "@/proxy";

const verifier = "neon_auth_session_verifier";
const challenge = "__Secure-neon-auth.session_challenge";
const origin = "https://wayfinder.example.test";
const request = (path: string, cookie?: string) => new NextRequest(`${origin}${path}`, {
  headers: cookie ? { cookie } : undefined,
});

beforeEach(() => {
  state.enabled = true;
  state.review.mockReset().mockResolvedValue({ token: "valid" });
  // Exercise the SDK's real exchange processor without next/headers, which its
  // framework adapter imports as a bundler-resolved extensionless module.
  state.getAuth.mockReset().mockResolvedValue({ middleware: () => async (req: NextRequest) => {
    const result = await processAuthMiddleware({
      request: req, pathname: req.nextUrl.pathname, skipRoutes: DEFAULT_AUTH_SKIP_ROUTES,
      loginUrl: '/auth/sign-in', baseUrl: 'https://auth.example.test/auth',
      cookieSecret: 'test-cookie-secret-that-is-at-least-32-characters', logLevel: 'silent',
    });
    if (result.action === 'allow') return NextResponse.next();
    const response = NextResponse.redirect(result.redirectUrl);
    for (const cookie of result.cookies ?? []) response.headers.append('Set-Cookie', cookie);
    return response;
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe("OAuth callback proxy", () => {
  it("matches verifier returns and review links, leaving normal anonymous routes alone", () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
    expect(matches("/review/token")).toBe(true);
    expect(matches(`/account?${verifier}=test`)).toBe(true);
    expect(matches(`/start?${verifier}=test`)).toBe(true);
    expect(matches(`/api/auth/get-session?${verifier}=test`)).toBe(false);
    expect(matches("/start")).toBe(false);
    expect(matches("/account")).toBe(false);
    expect(matches("/")).toBe(false);
  });

  it("uses the SDK exchange and preserves its session cookies and callback destination", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(null, {
      headers: { "Set-Cookie": "__Secure-neon-auth.session_token=test-session; HttpOnly; Secure; Path=/; SameSite=Lax" },
    }));
    vi.stubGlobal("fetch", fetchImpl);
    const response = await proxy(request(`/start?next=kept&${verifier}=test`, `${challenge}=test-challenge`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}/start?next=kept`);
    expect(response.headers.get("set-cookie")).toContain("__Secure-neon-auth.session_token=test-session");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain(`/get-session?next=kept&${verifier}=test`);
    expect(new Headers(init?.headers).get("cookie")).toContain(`${challenge}=test-challenge`);
    expect(state.review).not.toHaveBeenCalled();
  });

  it("also accepts the SDK's legacy challenge cookie", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(null)));
    const response = await proxy(request(`/account?${verifier}=test`, "__Secure-neon-auth.session_challange=legacy"));
    expect(response.headers.get("location")).toBe(`${origin}/account`);
  });

  it("does not enforce auth for ordinary anonymous visits, missing challenges, or disabled accounts", async () => {
    for (const req of [request("/start"), request(`/start?${verifier}=test`)]) {
      expect((await proxy(req)).headers.get("x-middleware-next")).toBe("1");
    }
    state.enabled = false;
    expect((await proxy(request(`/start?${verifier}=test`, `${challenge}=test`))).headers.get("x-middleware-next")).toBe("1");
    expect(state.getAuth).not.toHaveBeenCalled();
  });

  it("removes the verifier from a rejected exchange's login redirect", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "Invalid challenge" }, { status: 401 })));
    const response = await proxy(request(`/account?${verifier}=test`, `${challenge}=bad`));
    expect(response.headers.get("location")).toBe(`${origin}/auth/sign-in`);
  });

  it("keeps review-link validation ahead of OAuth completion", async () => {
    state.review.mockResolvedValue(null);
    const response = await proxy(request(`/review/forged?${verifier}=test`, `${challenge}=test`));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe(`${origin}/review-not-found`);
    expect(state.getAuth).not.toHaveBeenCalled();
  });

  it("retains review form retries when a lookup fails", async () => {
    state.review.mockRejectedValue(new Error("Database unavailable"));
    expect((await proxy(request("/review/valid"))).headers.get("x-middleware-next")).toBe("1");
  });
});
