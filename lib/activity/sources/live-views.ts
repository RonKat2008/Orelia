import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { browserLiveViews } from "@/db/schema";
import { hasDatabase } from "../db";
import type { ActivitySource, LaneLiveView, SourceResult } from "../types";

export interface LiveViewRow {
  contactId: string | null;
  url: string;
  host: string;
  phase: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

/** Pure: one lane live view per contact (newest running, unexpired session). Ended or expired sessions never show. */
export function liveViewLanes(rows: LiveViewRow[], now: Date): SourceResult["lanes"] {
  const best = new Map<string, LiveViewRow>();
  for (const r of rows) {
    if (!r.contactId || r.endedAt || r.expiresAt.getTime() <= now.getTime()) continue;
    if (r.phase !== "filling" && r.phase !== "submitting") continue;
    const prev = best.get(r.contactId);
    if (!prev || r.startedAt >= prev.startedAt) best.set(r.contactId, r);
  }
  return [...best.entries()].map(([contactId, r]) => {
    const liveView: LaneLiveView = { url: r.url, host: r.host, phase: r.phase as LaneLiveView["phase"], startedAt: r.startedAt.toISOString() };
    return { contactId, liveView };
  });
}

export const liveViewsSource: ActivitySource = {
  name: "live-views",
  async load(caseId) {
    if (!hasDatabase()) return { events: [] };
    const now = new Date();
    const rows = await getDb()
      .select()
      .from(browserLiveViews)
      .where(and(eq(browserLiveViews.caseId, caseId), isNull(browserLiveViews.endedAt), gt(browserLiveViews.expiresAt, now)))
      .orderBy(desc(browserLiveViews.startedAt))
      .limit(10);
    return { events: [], lanes: liveViewLanes(rows, now) };
  },
};
