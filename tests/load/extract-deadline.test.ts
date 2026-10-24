import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../lib/agents/intake-extractor", () => ({ extractCase: () => new Promise(() => {}) }));

import { resetMemoryRateLimitStore } from "../../lib/rate-limit";
import { POST } from "../../app/api/cases/route";

const ORIGIN = "http://localhost:3000";
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("WAYFINDER_SESSION_SECRET", "synthetic-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers(); resetMemoryRateLimitStore();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("answers 504 JSON when the model never replies, instead of hanging until the platform kills the request", async () => {
  const pending = POST(new Request(`${ORIGIN}/api/cases`, {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ reportText: "Synthetic report text that is long enough to pass validation." }),
  }));
  await vi.advanceTimersByTimeAsync(120_000);
  const res = await pending;
  expect(res.status).toBe(504);
  expect((await res.json() as { error: string }).error).toMatch(/try again/i);
});
