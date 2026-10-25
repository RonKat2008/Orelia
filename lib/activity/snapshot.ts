import { createHash } from "node:crypto";
import { defaultSources } from "./sources";
import { EVENT_CAP, type ActivityEvent, type ActivityLane, type ActivitySnapshot, type ActivitySource, type SourceResult } from "./types";

const BLANK_LANE: Omit<ActivityLane, "contactId"> = {
  resourceName: "Unknown resource", targetKind: "unknown", channel: "email", destinationLabel: "", state: "drafted",
  nextFollowUpAt: null, lastActivityAt: null, call: null, application: null,
};

const validTime = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NaN : t;
};

/** Pure: merge events (dedupe by id, sort by time asc, stable, keep the newest EVENT_CAP). */
export function mergeEvents(results: SourceResult[], cap = EVENT_CAP): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const r of results) for (const e of r.events) if (!Number.isNaN(validTime(e.at))) byId.set(e.id, e);
  const sorted = [...byId.values()].sort((a, b) => validTime(a.at) - validTime(b.at));
  return sorted.length > cap ? sorted.slice(sorted.length - cap) : sorted;
}

/** Pure: lane facts from every source, later sources win field by field; undefined never overrides. */
export function mergeLanes(results: SourceResult[], events: ActivityEvent[]): ActivityLane[] {
  const lanes = new Map<string, ActivityLane>();
  for (const r of results) {
    for (const partial of r.lanes ?? []) {
      const prev = lanes.get(partial.contactId) ?? { ...BLANK_LANE, contactId: partial.contactId };
      const defined = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined));
      lanes.set(partial.contactId, { ...prev, ...defined } as ActivityLane);
    }
  }
  const lastEvent = new Map<string, string>();
  for (const e of events) if (e.contactId) lastEvent.set(e.contactId, e.at);
  const out = [...lanes.values()].map((lane) => {
    const seen = lastEvent.get(lane.contactId);
    const lastActivityAt = [lane.lastActivityAt, seen].filter((x): x is string => !!x).sort().pop() ?? null;
    const state = lane.call?.live ? `call_${lane.call.status}` : lane.state;
    return { ...lane, lastActivityAt, state };
  });
  return out.sort((a, b) => Number(!!b.call?.live) - Number(!!a.call?.live) || a.resourceName.localeCompare(b.resourceName));
}

/** Removes provider listen URLs and browser live view URLs (judge view only may see them). Returns new objects; input is untouched. */
export function stripListenUrls(lanes: ActivityLane[]): ActivityLane[] {
  return lanes.map((lane) => {
    let next = lane;
    if (next.liveView !== undefined) {
      next = { ...next };
      delete next.liveView;
    }
    if (next.call && next.call.listenUrl !== undefined) {
      const call = { ...next.call };
      delete call.listenUrl;
      next = { ...next, call };
    }
    return next;
  });
}

export function snapshotCursor(lanes: ActivityLane[], events: ActivityEvent[]): string {
  return createHash("sha1").update(JSON.stringify({ lanes, events })).digest("hex").slice(0, 16);
}

/** Pure: build the snapshot from source results. */
export function buildSnapshot(input: { caseId: string; now: Date; results: SourceResult[]; judge: boolean }): ActivitySnapshot {
  const events = mergeEvents(input.results);
  const merged = mergeLanes(input.results, events);
  const lanes = input.judge ? merged : stripListenUrls(merged);
  return { caseId: input.caseId, now: input.now.toISOString(), lanes, events, cursor: snapshotCursor(lanes, events) };
}

/** Loads every source (a failing source is skipped and logged by name only) and builds the snapshot. */
export async function loadActivity(
  caseId: string,
  options: { judge: boolean; sources?: ActivitySource[]; now?: Date },
): Promise<ActivitySnapshot> {
  const sources = options.sources ?? defaultSources();
  const settled = await Promise.allSettled(sources.map((s) => s.load(caseId)));
  const results: SourceResult[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") results.push(r.value);
    else console.error(`[activity] source ${sources[i].name} failed`, r.reason instanceof Error ? r.reason.name : "error");
  });
  return buildSnapshot({ caseId, now: options.now ?? new Date(), results, judge: options.judge });
}
