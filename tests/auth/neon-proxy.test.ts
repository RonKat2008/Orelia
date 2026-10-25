import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getNeonAuth: vi.fn(), handle: vi.fn() }));
vi.mock("@/lib/auth/neon", () => ({ getNeonAuth: mocks.getNeonAuth }));
import { POST } from "@/app/api/auth/[...path]/route";

const context = { params: Promise.resolve({ path: ["sign-up", "email"] }) };
const request = (origin = "http://localhost:4321") => new Request("http://localhost:4321/api/auth/sign-up/email", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}",
});
beforeEach(() => {
  mocks.handle.mockReset();
  mocks.getNeonAuth.mockReset().mockResolvedValue({ handler: () => ({ POST: mocks.handle }) });
});

describe("account auth proxy", () => {
  it("preserves successful signup responses and session cookies", async () => {
    mocks.handle.mockResolvedValue(Response.json({ user: { id: "synthetic" } }, { headers: { "set-cookie": "test-session=value; HttpOnly; Path=/" } }));
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("test-session=");
  });
  it("keeps cross-origin signup requests blocked", async () => {
    const response = await POST(request("https://untrusted.example"), context);
    expect(response.status).toBe(403);
    expect(mocks.getNeonAuth).not.toHaveBeenCalled();
  });
  it("returns an actionable unavailable response without configured accounts", async () => {
    mocks.getNeonAuth.mockRejectedValue(new Error("not configured"));
    const response = await POST(request(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "AUTH_UNAVAILABLE", message: expect.stringContaining("without an account") });
  });
  it("handles provider failures without exposing internal details", async () => {
    mocks.handle.mockRejectedValue(new Error("private provider endpoint and credentials"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(request(), context);
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain("temporarily unavailable");
      expect(body).not.toContain("credentials");
    } finally { log.mockRestore(); }
  });
});
