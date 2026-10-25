import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/lib/activity/snapshot";
import { liveViewLanes, type LiveViewRow } from "@/lib/activity/sources/live-views";
import { isKernelLiveViewUrl } from "@/components/live/WatchAgent";

const now = new Date("2026-01-01T00:01:00Z");
const row = (o: Partial<LiveViewRow> = {}): LiveViewRow => ({
  contactId: "k1", url: "https://api.onkernel.com/browser/live/T?readOnly=true", host: "api.onkernel.com", phase: "filling",
  startedAt: new Date("2026-01-01T00:00:30Z"), expiresAt: new Date("2026-01-01T00:02:30Z"), endedAt: null, ...o,
});

describe("liveViewLanes", () => {
  it("shows a running, unexpired session", () => {
    expect(liveViewLanes([row()], now)).toEqual([{ contactId: "k1", liveView: { url: row().url, host: "api.onkernel.com", phase: "filling", startedAt: "2026-01-01T00:00:30.000Z" } }]);
  });
  it("hides ended and expired sessions", () => {
    expect(liveViewLanes([row({ endedAt: new Date("2026-01-01T00:00:50Z") })], now)).toEqual([]);
    expect(liveViewLanes([row({ expiresAt: new Date("2026-01-01T00:01:00Z") })], now)).toEqual([]);
    expect(liveViewLanes([row({ contactId: null })], now)).toEqual([]);
  });
});

describe("judge-only exposure", () => {
  const results = [{ events: [], lanes: liveViewLanes([row()], now) }];
  it("judge snapshot carries the live view url", () => {
    const snap = buildSnapshot({ caseId: "c", now, results, judge: true });
    expect(snap.lanes[0]?.liveView?.url).toContain("onkernel.com");
  });
  it("patient snapshot never carries it", () => {
    const snap = buildSnapshot({ caseId: "c", now, results, judge: false });
    expect(JSON.stringify(snap)).not.toContain("onkernel");
    expect(snap.lanes[0]?.liveView).toBeUndefined();
  });
});

describe("iframe url guard", () => {
  it("embeds only https Kernel hosts", () => {
    expect(isKernelLiveViewUrl("https://api.onkernel.com/browser/live/x")).toBe(true);
    expect(isKernelLiveViewUrl("https://evil.com/?onkernel.com")).toBe(false);
    expect(isKernelLiveViewUrl("http://api.onkernel.com/x")).toBe(false);
  });
});
