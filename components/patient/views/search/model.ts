import type { PatientStatus, PatientTimelineItem } from "@/lib/patient-status/types";
import { SEARCH_COPY } from "./copy";

export const DEFAULT_SOURCE_COUNT = 9;
export const MAX_SEARCH_ROWS = 3;

export type SearchPhase = "searching" | "done" | "failed" | "none" | "not_started";

/** Where the search stands, from the deterministic patient status. */
export function searchPhase(status: PatientStatus): SearchPhase {
  const kind = status.nextAction?.kind;
  if (kind === "retry_search") return "failed";
  if (kind === "pick_contacts") return "done";
  if (status.step === "tell") return "not_started";
  if (status.step === "search") return "searching";
  // Past the search step: with no one to pick (tone "problem") nothing was found.
  if (status.step === "choose" && status.tone === "problem" && !kind) return "none";
  return "done";
}

/** How many people the search found, from the timeline or headline. Null when neither says. */
export function foundCount(status: PatientStatus, timeline: readonly PatientTimelineItem[]): number | null {
  const fromTimeline = timeline.map((item) => /found (\d+)/i.exec(item.text)).find(Boolean);
  const match = fromTimeline ?? /Found (\d+)/.exec(status.headline);
  if (match) return Number(match[1]);
  if (/Found 1 person/.test(status.headline)) return 1;
  return null;
}

export function sourceTotal(status: PatientStatus): number {
  return status.progress?.total && status.progress.total > 0 ? status.progress.total : DEFAULT_SOURCE_COUNT;
}

/** Up to three quiet rows in plain words. No agent names: only what is being read, or what happened. */
export function searchRows(status: PatientStatus, timeline: readonly PatientTimelineItem[], phase: SearchPhase): string[] {
  const rows: string[] = [];
  if (phase === "searching") {
    const now = /^Right now: (.+)\.$/.exec(status.detail ?? "")?.[1];
    if (now) rows.push(SEARCH_COPY.rowNow(now));
    else if (status.progress && status.progress.done >= status.progress.total) rows.push(SEARCH_COPY.rowWorking);
  }
  for (const item of timeline) {
    if (rows.length >= MAX_SEARCH_ROWS) break;
    if (item.id === "search-start" || item.id === "search-done") rows.push(item.text);
  }
  return rows.slice(0, MAX_SEARCH_ROWS);
}
