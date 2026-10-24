import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEnv } from "@/lib/env";
import { inngestSendEvents } from "@/lib/workflows/events";

const prodNoInngest = {
  DATABASE_URL: "x", ANTHROPIC_API_KEY: "x", OUTBOUND_ALLOWLIST: "x", WAYFINDER_SESSION_SECRET: "x",
  AGENTMAIL_WEBHOOK_SECRET: "x", AGENTCALL_WEBHOOK_SECRET: "x", EXA_API_KEY: "x",
};

describe("inngest is optional at build time", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("missing INNGEST_* is a warning, not a failure, in prod", () => {
    const r = checkEnv("prod", prodNoInngest);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/Inngest is not configured/);
  });

  it("webhook secrets stay required", () => {
    const rest: Record<string, string> = { ...prodNoInngest };
    delete rest.AGENTCALL_WEBHOOK_SECRET;
    expect(checkEnv("prod", rest).missing.map((m) => m.name)).toEqual(["AGENTCALL_WEBHOOK_SECRET"]);
  });

  it("workflow events fail closed without Inngest keys", async () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    vi.stubEnv("INNGEST_DEV", "");
    await expect(inngestSendEvents()({ name: "x", data: {} } as never)).rejects.toThrow(/not configured/);
  });
});
