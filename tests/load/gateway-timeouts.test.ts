import { afterEach, expect, it, vi } from "vitest";
import { createClaudeClient, MODEL_CALL_TIMEOUT_MS } from "@/lib/ai/gateway";

afterEach(() => vi.unstubAllEnvs());

it("bounds every model call: finite per-attempt timeout and a single retry", () => {
  vi.stubEnv("NEON_AI_GATEWAY_BASE_URL", "https://gateway.invalid");
  vi.stubEnv("NEON_AI_GATEWAY_TOKEN", "synthetic");
  const client = createClaudeClient();
  expect(client.timeout).toBe(MODEL_CALL_TIMEOUT_MS);
  expect(MODEL_CALL_TIMEOUT_MS).toBeLessThanOrEqual(100_000);
  expect(client.maxRetries).toBe(1);
});
