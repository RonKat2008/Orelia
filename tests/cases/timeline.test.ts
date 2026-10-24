import { describe, expect, it } from "vitest";
import { isCallEvent, isMailEvent } from "../../lib/cases/timeline";

describe("thread timeline filters", () => {
  it("drops an outbound email that was never sent", () => {
    expect(isMailEvent({ direction: "outbound", sentAt: null, receivedAt: null })).toBe(false);
  });
  it("keeps a sent outbound email", () => {
    expect(isMailEvent({ direction: "outbound", sentAt: new Date(), receivedAt: null })).toBe(true);
  });
  it("keeps a received reply and drops an inbound row with no time", () => {
    expect(isMailEvent({ direction: "inbound", sentAt: null, receivedAt: new Date() })).toBe(true);
    expect(isMailEvent({ direction: "inbound", sentAt: null, receivedAt: null })).toBe(false);
  });
  it("drops a call script draft that never started", () => {
    expect(isCallEvent({ transcript: "Hello, I am calling on behalf of...", startedAt: null })).toBe(false);
  });
  it("drops a started call with no transcript", () => {
    expect(isCallEvent({ transcript: "", startedAt: new Date() })).toBe(false);
  });
  it("keeps a call that happened and has a transcript", () => {
    expect(isCallEvent({ transcript: "Spoke with intake.", startedAt: new Date() })).toBe(true);
  });
});

describe("MemoryCaseActivity threads", () => {
  it("omits entries with no recorded time (unsent drafts)", async () => {
    const { MemoryCaseActivity } = await import("../../lib/cases/activity");
    const a = new MemoryCaseActivity();
    const cid = "11111111-1111-4111-8111-111111111111";
    const contactId = "22222222-2222-4222-8222-222222222222";
    a.seedContact(cid, { id: contactId, targetKind: "institution", targetId: "33333333-3333-4333-8333-333333333333", displayName: "Center", channel: "voice", state: "drafted", nextFollowUpAt: null, lastActivityAt: null, consented: true, approved: false });
    const base = { contactId, direction: "outbound" as const, channel: "voice" as const, subject: null, sharedFields: [], classification: null };
    a.seedMessage(cid, { ...base, id: "44444444-4444-4444-8444-444444444444", body: "Script draft", at: null });
    a.seedMessage(cid, { ...base, id: "55555555-5555-4555-8555-555555555555", body: "Transcript", at: "2026-10-24T10:00:00.000Z" });
    const [thread] = await a.threads(cid);
    expect(thread.messages.map((m) => m.body)).toEqual(["Transcript"]);
  });
});
