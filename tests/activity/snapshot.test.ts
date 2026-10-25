import { describe, expect, it, vi } from "vitest";
import { buildSnapshot, loadActivity, mergeEvents, mergeLanes, stripListenUrls } from "@/lib/activity/snapshot";
import { EVENT_CAP, type ActivityEvent, type ActivityLane, type ActivitySource, type LiveCall } from "@/lib/activity/types";

const ev = (id: string, at: string, contactId: string | null = null): ActivityEvent => ({ id, at, kind: "email_sent", contactId, title: id });
const call = (over: Partial<LiveCall> = {}): LiveCall => ({
  id: "c1", provider: "vapi", status: "connected", live: true, endedReason: null, summary: null, outcome: null,
  startedAt: "2026-01-01T00:00:00.000Z", endedAt: null, turns: [], listenUrl: "wss://listen.example/secret", ...over,
});

describe("mergeEvents", () => {
  it("sorts oldest first, dedupes by id (later source wins) and drops invalid times", () => {
    const merged = mergeEvents([
      { events: [ev("b", "2026-01-01T00:00:02Z"), ev("a", "2026-01-01T00:00:01Z"), ev("bad", "nope")] },
      { events: [{ ...ev("b", "2026-01-01T00:00:02Z"), title: "newer" }] },
    ]);
    expect(merged.map((e) => e.id)).toEqual(["a", "b"]);
    expect(merged[1].title).toBe("newer");
  });

  it("keeps the newest EVENT_CAP events", () => {
    const events = Array.from({ length: EVENT_CAP + 20 }, (_, i) => ev(`e${i}`, new Date(1_700_000_000_000 + i * 1000).toISOString()));
    const merged = mergeEvents([{ events }]);
    expect(merged).toHaveLength(EVENT_CAP);
    expect(merged[merged.length - 1].id).toBe(`e${EVENT_CAP + 19}`);
  });
});

describe("mergeLanes", () => {
  it("merges partial lane facts field by field and ignores undefined", () => {
    const lanes = mergeLanes(
      [
        { events: [], lanes: [{ contactId: "x", resourceName: "Clinic", channel: "voice", state: "sent", lastActivityAt: "2026-01-01T00:00:00.000Z" }] },
        { events: [], lanes: [{ contactId: "x", destinationLabel: "Phone ending 4242", resourceName: undefined }] },
      ],
      [ev("e1", "2026-01-02T00:00:00.000Z", "x")],
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ resourceName: "Clinic", destinationLabel: "Phone ending 4242", channel: "voice", state: "sent" });
    expect(lanes[0].lastActivityAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("shows a live call as the lane state and sorts live lanes first", () => {
    const lanes = mergeLanes(
      [{ events: [], lanes: [
        { contactId: "a", resourceName: "A first", state: "sent" },
        { contactId: "b", resourceName: "Z live", state: "sent", call: call({ status: "ringing" }) },
      ] }],
      [],
    );
    expect(lanes.map((l) => l.contactId)).toEqual(["b", "a"]);
    expect(lanes[0].state).toBe("call_ringing");
  });
});

describe("listenUrl handling", () => {
  const source: ActivitySource = {
    name: "fake",
    async load() {
      return { events: [], lanes: [{ contactId: "x", resourceName: "Clinic", call: call() }] };
    },
  };

  it("is stripped when judge=false and kept when judge=true", async () => {
    const patient = await loadActivity("case", { judge: false, sources: [source] });
    const judge = await loadActivity("case", { judge: true, sources: [source] });
    expect(JSON.stringify(patient)).not.toContain("listen.example");
    expect(patient.lanes[0].call?.listenUrl).toBeUndefined();
    expect(judge.lanes[0].call?.listenUrl).toBe("wss://listen.example/secret");
  });

  it("stripListenUrls does not mutate its input", () => {
    const lane = { contactId: "x", call: call() } as ActivityLane;
    stripListenUrls([lane]);
    expect(lane.call?.listenUrl).toBe("wss://listen.example/secret");
  });
});

describe("loadActivity", () => {
  it("skips a failing source and keeps the rest", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad: ActivitySource = { name: "bad", load: async () => { throw new Error("db down secret"); } };
    const good: ActivitySource = { name: "good", load: async () => ({ events: [ev("a", "2026-01-01T00:00:00Z")] }) };
    const snap = await loadActivity("case", { judge: false, sources: [bad, good] });
    expect(snap.events.map((e) => e.id)).toEqual(["a"]);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
  });

  it("changes the cursor only when content changes, not when `now` does", () => {
    const results = [{ events: [ev("a", "2026-01-01T00:00:00Z")] }];
    const one = buildSnapshot({ caseId: "c", now: new Date(1000), results, judge: false });
    const two = buildSnapshot({ caseId: "c", now: new Date(9000), results, judge: false });
    const three = buildSnapshot({ caseId: "c", now: new Date(9000), results: [{ events: [...results[0].events, ev("b", "2026-01-01T00:00:01Z")] }], judge: false });
    expect(one.cursor).toBe(two.cursor);
    expect(three.cursor).not.toBe(one.cursor);
  });
});
