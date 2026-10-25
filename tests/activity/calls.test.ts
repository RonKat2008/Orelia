import { describe, expect, it } from "vitest";
import {
  callEvents, callLanes, chooseCallLiveSource, deriveCallStatus, normalizeCallStatus, overlayLive, recordsFromRows, type CallRow,
} from "@/lib/activity/sources/calls";
import { parseTranscript } from "@/lib/activity/transcript";
import type { CallLiveSource } from "@/lib/activity/types";

const row = (over: Partial<CallRow> = {}): CallRow => ({
  id: "call-1", contactId: "contact-1", approvedAt: new Date("2026-01-01T00:00:00Z"), startedAt: new Date("2026-01-01T00:01:00Z"),
  endedAt: null, transcript: null, outcome: null, ...over,
});

describe("parseTranscript", () => {
  it("splits AI/Callee lines and joins continuation lines", () => {
    const turns = parseTranscript("AI: Hello, I am calling for a patient.\nCallee: Sure,\nthat works.\nAI: Thank you.");
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["ai", "Hello, I am calling for a patient."],
      ["human", "Sure, that works."],
      ["ai", "Thank you."],
    ]);
    expect(turns.map((t) => t.seq)).toEqual([0, 1, 2]);
  });

  it("handles empty input and unlabeled text", () => {
    expect(parseTranscript(null)).toEqual([]);
    expect(parseTranscript("  \n ")).toEqual([]);
    expect(parseTranscript("<b>hi</b>")[0].text).toBe("<b>hi</b>");
  });
});

describe("implementation A (calls row)", () => {
  it("derives status from the row", () => {
    expect(deriveCallStatus(row({ startedAt: null }))).toBe("queued");
    expect(deriveCallStatus(row())).toBe("ringing");
    expect(deriveCallStatus(row({ transcript: "AI: hi" }))).toBe("connected");
    expect(deriveCallStatus(row({ endedAt: new Date(), transcript: "AI: hi" }))).toBe("ended");
    expect(deriveCallStatus(row({ outcome: "no_answer" }))).toBe("ended");
  });

  it("builds ordered, deterministic events for an ended call", () => {
    const records = recordsFromRows([row({ endedAt: new Date("2026-01-01T00:03:00Z"), outcome: "completed", transcript: "AI: Hi\nCallee: Hello" })]);
    const events = callEvents(records);
    expect(events.map((e) => e.id)).toEqual([
      "call:call-1:queued", "call:call-1:ringing", "call:call-1:connected", "call:call-1:turn:0", "call:call-1:turn:1", "call:call-1:ended",
    ]);
    expect(callEvents(records)).toEqual(events);
    expect(records[0].live).toBe(false);
    expect(callLanes(records)[0]).toMatchObject({ contactId: "contact-1", call: { status: "ended" } });
  });
});

describe("implementation B (call_live / call_turns)", () => {
  it("maps Vapi statuses", () => {
    expect(normalizeCallStatus("in-progress")).toBe("connected");
    expect(normalizeCallStatus("forwarding")).toBe("connected");
    expect(normalizeCallStatus("ringing")).toBe("ringing");
    expect(normalizeCallStatus("weird")).toBeNull();
  });

  it("overlays provider status, turns, summary and listen url", () => {
    const base = recordsFromRows([row()]);
    const [rec] = overlayLive(
      base,
      [{ callId: "call-1", provider: "vapi", status: "in-progress", endedReason: null, summary: "short", listenUrl: "wss://x" }],
      [
        { callId: "call-1", seq: 2, role: "human", text: "Yes", spokenAt: "2026-01-01T00:01:10Z" },
        { callId: "call-1", seq: 1, role: "ai", text: "Hello", spokenAt: "2026-01-01T00:01:05Z" },
      ],
    );
    expect(rec.status).toBe("connected");
    expect(rec.live).toBe(true);
    expect(rec.turns.map((t) => t.text)).toEqual(["Hello", "Yes"]);
    expect(rec.listenUrl).toBe("wss://x");
    expect(callEvents([rec]).some((e) => JSON.stringify(e).includes("wss://"))).toBe(false);
  });
});

describe("source selection", () => {
  const a: CallLiveSource = { name: "calls-row", load: async () => [] };
  const b: CallLiveSource = { name: "call-live", load: async () => [] };
  it("picks B only when both tables exist", () => {
    expect(chooseCallLiveSource({ callLive: true, callTurns: true }, a, b)).toBe(b);
    expect(chooseCallLiveSource({ callLive: true, callTurns: false }, a, b)).toBe(a);
    expect(chooseCallLiveSource({ callLive: false, callTurns: false }, a, b)).toBe(a);
  });
});
