import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLiveSync, type SourceLike, type SyncConnection } from "@/components/swarm/liveSync";

class FakeSource implements SourceLike {
  readyState = 0;
  closed = false;
  private readonly handlers = new Map<string, Array<(e: Event) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (e: Event) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() { this.closed = true; }
  emit(type: string, data?: string) {
    for (const fn of this.handlers.get(type) ?? []) fn({ data } as unknown as Event);
  }
}

const snap = (caseStatus: string, extra: Record<string, unknown> = {}) => JSON.stringify({ caseId: "c", caseStatus, runs: [], ...extra });

function harness(statusReplies: Array<() => Promise<Response>> = []) {
  const sources: FakeSource[] = [];
  const snapshots: string[] = [];
  const connections: SyncConnection[] = [];
  const done: Array<string | undefined> = [];
  const fetchStatus = vi.fn(async () => {
    const next = statusReplies.shift();
    if (!next) throw new Error("offline");
    return next();
  });
  const sync = startLiveSync({
    caseId: "c",
    createSource: (url) => { const s = new FakeSource(url); sources.push(s); return s; },
    fetchStatus,
    onSnapshot: (d) => snapshots.push(d),
    onConnection: (c) => connections.push(c),
    onDone: (s) => done.push(s),
  });
  return { sync, sources, snapshots, connections, done, fetchStatus };
}

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("startLiveSync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes live on the first snapshot and finishes on done", () => {
    const h = harness();
    h.sources[0]!.emit("runs", snap("researching"));
    expect(h.connections).toEqual(["live"]);
    h.sources[0]!.emit("done", JSON.stringify({ caseStatus: "ready" }));
    expect(h.done).toEqual(["ready"]);
    expect(h.sources[0]!.closed).toBe(true);
  });

  it("falls back to polling right away when the stream errors, and reaches ready", async () => {
    const h = harness([json({ caseStatus: "researching", runs: [], finished: false }), json({ caseStatus: "ready", runs: [], finished: true })]);
    h.sources[0]!.emit("runs", snap("researching"));
    h.sources[0]!.emit("error");
    expect(h.connections).toEqual(["live", "polling"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchStatus).toHaveBeenCalledWith("/api/cases/c/status");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.done).toEqual(["ready"]);
    expect(h.snapshots).toHaveLength(3);
  });

  it("starts polling when no snapshot arrives for 20s, without a stream error", async () => {
    const h = harness([json({ caseStatus: "researching", runs: [], finished: false })]);
    h.sources[0]!.emit("runs", snap("researching"));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(h.connections).toEqual(["live"]);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(h.connections).toContain("polling");
    expect(h.fetchStatus).toHaveBeenCalled();
  });

  it("reconnects the stream with backoff and returns to live, ending the polling", async () => {
    const h = harness();
    h.sources[0]!.emit("runs", snap("researching"));
    h.sources[0]!.emit("error");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sources).toHaveLength(2);
    h.sources[1]!.emit("error");
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.sources).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sources).toHaveLength(3);
    h.sources[2]!.emit("runs", snap("researching"));
    expect(h.connections.at(-1)).toBe("live");
    const calls = h.fetchStatus.mock.calls.length;
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      h.sources[2]!.emit("runs", snap("researching"));
    }
    expect(h.fetchStatus.mock.calls.length).toBe(calls);
  });

  it("surfaces research_failed from a poll so the retry button can show", async () => {
    const h = harness([json({ caseStatus: "research_failed", runs: [], finished: true })]);
    h.sources[0]!.emit("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.done).toEqual(["research_failed"]);
  });

  it("keeps polling through network failures", async () => {
    const h = harness([() => Promise.reject(new Error("x")), json({ caseStatus: "ready", runs: [], finished: true })]);
    h.sources[0]!.emit("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.done).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.done).toEqual(["ready"]);
  });

  it("reports lost when the case is not accessible", async () => {
    const h = harness([json({ error: "nope" }, 404)]);
    h.sources[0]!.emit("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.connections.at(-1)).toBe("lost");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels every timer and the stream", async () => {
    const h = harness();
    h.sources[0]!.emit("error");
    h.sync.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchStatus).not.toHaveBeenCalled();
    expect(h.sources).toHaveLength(1);
  });
});
