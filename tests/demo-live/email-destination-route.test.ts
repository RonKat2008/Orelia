import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guardCase: vi.fn(async (..._a: [Request, string]): Promise<Response | null> => null),
  rejectCrossOrigin: vi.fn((_r: Request): Response | null => null),
  liveDemoEnabled: vi.fn((_e: unknown) => true),
  isLiveDemoCase: vi.fn(async (_id: string) => true),
  set: vi.fn(async (..._a: unknown[]) => {}),
  reroute: vi.fn(async (..._a: unknown[]) => 2),
  tick: vi.fn(async () => ({ ok: true, steps: {} })),
  skip: vi.fn(async () => ({ shifted: 0, agentsWoken: 0 })),
}));
vi.mock("@/lib/auth/ownership", () => ({ guardCase: mocks.guardCase }));
vi.mock("@/lib/auth/origin", () => ({ rejectCrossOrigin: mocks.rejectCrossOrigin }));
vi.mock("@/lib/demo-live/start", () => ({ liveDemoEnabled: mocks.liveDemoEnabled }));
vi.mock("@/lib/demo-live/skip-ahead", () => ({ isLiveDemoCase: mocks.isLiveDemoCase, skipAhead: mocks.skip }));
vi.mock("@/lib/workflows/cron-tick", () => ({ runCronTick: mocks.tick }));
vi.mock("@/lib/demo-live/email-destination", () => ({ setEmailDestinationChoice: mocks.set, rerouteDraftedEmailContacts: mocks.reroute }));

import { POST } from "@/app/api/cases/[id]/demo-live/route";

const ID = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) =>
  POST(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });

const ENV_KEYS = ["WAYFINDER_DEMO_COORDINATORS", "OUTBOUND_ALLOWLIST", "DEMO_COORDINATOR_INBOXES", "AGENTMAIL_SENDER_INBOX_ID"] as const;
const saved: Record<string, string | undefined> = {};
function env(v: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) { if (v[k] === undefined) delete process.env[k]; else process.env[k] = v[k]; }
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.values(mocks).forEach((m) => m.mockClear());
  mocks.guardCase.mockResolvedValue(null);
  mocks.rejectCrossOrigin.mockReturnValue(null);
  mocks.liveDemoEnabled.mockReturnValue(true);
  mocks.isLiveDemoCase.mockResolvedValue(true);
  env({ WAYFINDER_DEMO_COORDINATORS: "1", OUTBOUND_ALLOWLIST: "a@agentmail.to,me@gmail.com", DEMO_COORDINATOR_INBOXES: "a@agentmail.to,me@gmail.com" });
  return () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
});

describe("POST demo-live email_destination", () => {
  it("stores a valid choice, moves unsent contacts, and never runs the cron tick", async () => {
    const res = await post({ action: "email_destination", value: "personal" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, choice: "personal", rerouted: 2 });
    expect(JSON.stringify(json)).not.toMatch(/@/);
    expect(mocks.set).toHaveBeenCalledWith(ID, "personal");
    expect(mocks.reroute).toHaveBeenCalledWith(ID, expect.anything(), "personal");
    expect(mocks.tick).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin request before anything else", async () => {
    mocks.rejectCrossOrigin.mockReturnValue(new Response("no", { status: 403 }));
    expect((await post({ action: "email_destination", value: "personal" })).status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("rejects a non-owner via the ownership guard", async () => {
    mocks.guardCase.mockResolvedValue(new Response("no", { status: 404 }));
    expect((await post({ action: "email_destination", value: "personal" })).status).toBe(404);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("is 404 when demo mode is off or the case is not a live demo case", async () => {
    mocks.liveDemoEnabled.mockReturnValue(false);
    expect((await post({ action: "email_destination", value: "personal" })).status).toBe(404);
    mocks.liveDemoEnabled.mockReturnValue(true);
    mocks.isLiveDemoCase.mockResolvedValue(false);
    expect((await post({ action: "email_destination", value: "personal" })).status).toBe(404);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("validates the value: only the two words, no addresses, no extra keys", async () => {
    for (const bad of [{ value: "me@gmail.com" }, { value: "" }, { value: 1 }, {}, { value: "personal", address: "x@y.com" }]) {
      const res = await post({ action: "email_destination", ...bad });
      expect(res.status).toBe(400);
    }
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("refuses an option whose group is empty", async () => {
    env({ WAYFINDER_DEMO_COORDINATORS: "1", OUTBOUND_ALLOWLIST: "a@agentmail.to", DEMO_COORDINATOR_INBOXES: "a@agentmail.to" });
    expect((await post({ action: "email_destination", value: "personal" })).status).toBe(409);
    expect(mocks.set).not.toHaveBeenCalled();
    expect((await post({ action: "email_destination", value: "scripted" })).status).toBe(200);
  });
  it("still runs tick and skip_ahead as before", async () => {
    expect((await post({ action: "tick" })).status).toBe(200);
    expect(mocks.tick).toHaveBeenCalledTimes(1);
    expect((await post({ action: "skip_ahead" })).status).toBe(200);
    expect(mocks.skip).toHaveBeenCalledTimes(1);
  });
});
