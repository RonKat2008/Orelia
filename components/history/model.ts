import {
  CONFLICT_NOTE,
  EVENT_KINDS,
  MAX_RECORD_CHARS,
  SHARE_SECTIONS,
  type Conflict,
  type EventKind,
  type HistoryEvent,
  type HistoryShare,
  type ShareSection,
} from "@/lib/history/contract";

export const UNDATED = "Undated";
export const TEXT_FILE_PATTERN = /\.(txt|md|markdown)$/i;
export const PDF_FILE_PATTERN = /\.pdf$/i;
export const MAX_PDF_MB = 10;
export const PDF_TOO_LARGE_MESSAGE = `That PDF is larger than ${MAX_PDF_MB} MB. Open it, copy its text, and paste it into the box below.`;
export const SHARE_EXPIRY_DAYS = [1, 7, 14, 30] as const;

export type YearGroup = { year: string; events: HistoryEvent[] };

export function yearOf(date: string | null): string {
  return date ? date.slice(0, 4) : UNDATED;
}

/** Groups events (already date-sorted) by year; undated events go last. */
export function groupByYear(events: readonly HistoryEvent[]): YearGroup[] {
  const groups = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const year = yearOf(event.date);
    groups.set(year, [...(groups.get(year) ?? []), event]);
  }
  const years = [...groups.keys()].sort((a, b) =>
    a === UNDATED ? 1 : b === UNDATED ? -1 : a.localeCompare(b),
  );
  return years.map((year) => ({ year, events: groups.get(year) ?? [] }));
}

/** Parses `?kinds=a,b`, dropping unknown values and duplicates. */
export function parseKinds(param: string | null | undefined): EventKind[] {
  if (!param) return [];
  const wanted = new Set(param.split(",").map((value) => value.trim()));
  return EVENT_KINDS.filter((kind) => wanted.has(kind));
}

export function kindsToParam(kinds: readonly EventKind[]): string | null {
  return kinds.length === 0 ? null : EVENT_KINDS.filter((kind) => kinds.includes(kind)).join(",");
}

export function toggleKind(kinds: readonly EventKind[], kind: EventKind): EventKind[] {
  return kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
}

/** An empty selection means "show everything". */
export function filterEvents(events: readonly HistoryEvent[], kinds: readonly EventKind[]): HistoryEvent[] {
  return kinds.length === 0 ? [...events] : events.filter((event) => kinds.includes(event.kind));
}

export function kindCounts(events: readonly HistoryEvent[]): Record<EventKind, number> {
  const counts = Object.fromEntries(EVENT_KINDS.map((kind) => [kind, 0])) as Record<EventKind, number>;
  for (const event of events) counts[event.kind] += 1;
  return counts;
}

/** eventId -> conflicts that quote that event. */
export function conflictEventIndex(conflicts: readonly Conflict[]): Map<string, Conflict[]> {
  const index = new Map<string, Conflict[]>();
  for (const conflict of conflicts) {
    for (const statement of conflict.statements) {
      const list = index.get(statement.eventId) ?? [];
      if (!list.includes(conflict)) index.set(statement.eventId, [...list, conflict]);
    }
  }
  return index;
}

export function formatPartialDate(date: string | null): string {
  if (!date) return "Date not given";
  const [year, month, day] = date.split("-").map(Number);
  if (!month) return String(year);
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return day ? `${monthName} ${day}, ${year}` : `${monthName} ${year}`;
}

export function yearAnchorId(year: string): string {
  return `history-year-${year}`;
}

export function eventAnchorId(eventId: string): string {
  return `history-event-${eventId}`;
}

export type FileCheck =
  | { ok: true; title: string }
  | { ok: false; reason: "pdf" | "type" | "empty" | "too_long"; message: string };

export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;
}

/** Validates a picked file before reading it; text length is checked after reading. */
export function checkRecordFile(name: string): FileCheck {
  if (PDF_FILE_PATTERN.test(name)) return { ok: true, title: titleFromFilename(name) };
  if (!TEXT_FILE_PATTERN.test(name)) {
    return { ok: false, reason: "type", message: `${name}: only .txt, .md and .pdf files can be added. Paste other records instead.` };
  }
  return { ok: true, title: titleFromFilename(name) };
}

export function checkRecordText(name: string, text: string): FileCheck {
  if (!text.trim()) return { ok: false, reason: "empty", message: `${name} is empty.` };
  if (text.length > MAX_RECORD_CHARS) {
    return {
      ok: false,
      reason: "too_long",
      message: `${name} is longer than ${MAX_RECORD_CHARS.toLocaleString("en-US")} characters. Split it into parts.`,
    };
  }
  return { ok: true, title: titleFromFilename(name) };
}

export const SHARE_SECTION_LABELS: Record<ShareSection, string> = {
  diagnosis: "Diagnoses",
  genetic_test: "Genetic tests",
  specialist_visit: "Specialist visits",
  imaging: "Imaging",
  lab: "Labs",
  procedure: "Procedures",
  medication: "Medications",
  hospitalization: "Hospital stays",
  note: "Notes",
  conflicts: "Conflicts to discuss",
};

export function defaultShareSections(): ShareSection[] {
  return [...SHARE_SECTIONS];
}

export function toggleSection(sections: readonly ShareSection[], section: ShareSection): ShareSection[] {
  const next = sections.includes(section) ? sections.filter((s) => s !== section) : [...sections, section];
  return SHARE_SECTIONS.filter((s) => next.includes(s));
}

export type ShareStatus = "active" | "expired" | "revoked";
export type ListedShare = HistoryShare & { status: ShareStatus };

export const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function matchLabel(match: "keyword" | "semantic" | "both"): string {
  return match === "keyword" ? "Word match" : match === "semantic" ? "Similar meaning" : "Word and meaning match";
}

export { CONFLICT_NOTE };
