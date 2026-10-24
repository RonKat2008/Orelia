"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import {
  BedDouble, Dna, FlaskConical, Pill, ScanLine, Scale, Scissors, Stethoscope, StickyNote, UserRound, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { EVENT_KINDS, EVENT_KIND_LABELS, type Conflict, type EventKind, type HistoryEvent } from "@/lib/history/contract";
import {
  conflictEventIndex, eventAnchorId, formatPartialDate, groupByYear, kindCounts, yearAnchorId,
} from "./model";

const KIND_ICONS: Record<EventKind, LucideIcon> = {
  diagnosis: Stethoscope, genetic_test: Dna, specialist_visit: UserRound, imaging: ScanLine, lab: FlaskConical,
  procedure: Scissors, medication: Pill, hospitalization: BedDouble, note: StickyNote,
};
const STAGGER_CAP = 12;
const STAGGER_STEP = 0.04;

export function scrollToId(id: string, reduced: boolean) {
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

export function KindFilters({
  events, selected, onToggle, onClear,
}: {
  events: readonly HistoryEvent[]; selected: readonly EventKind[]; onToggle: (kind: EventKind) => void; onClear: () => void;
}) {
  const counts = useMemo(() => kindCounts(events), [events]);
  return (
    <div role="group" aria-label="Filter by kind" className="flex flex-wrap items-center gap-2">
      {EVENT_KINDS.filter((kind) => counts[kind] > 0 || selected.includes(kind)).map((kind) => {
        const Icon = KIND_ICONS[kind];
        const on = selected.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(kind)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-small font-semibold focus-ring",
              "transition-colors motion-reduce:transition-none",
              on ? "border-teal bg-teal text-on-teal" : "border-line-strong bg-card text-ink hover:bg-paper-2",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {EVENT_KIND_LABELS[kind]}
            <span className={on ? "opacity-90" : "text-ink-2"}>{counts[kind]}</span>
          </button>
        );
      })}
      {selected.length > 0 ? (
        <button type="button" onClick={onClear} className="min-h-11 rounded-sm px-2 text-small font-semibold text-teal underline underline-offset-4 focus-ring">
          Show all
        </button>
      ) : null}
    </div>
  );
}

function EventCard({
  event, conflicts, titles, highlighted, index, reduced,
}: {
  event: HistoryEvent; conflicts: Conflict[]; titles: Map<string, string>; highlighted: boolean; index: number; reduced: boolean;
}) {
  const Icon = KIND_ICONS[event.kind];
  const who = [event.provider, event.institution].filter(Boolean).join(" at ");
  return (
    <motion.li
      id={eventAnchorId(event.id)}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, STAGGER_CAP) * STAGGER_STEP }}
      className={cn(
        "relative grid scroll-mt-24 gap-2 rounded-md border bg-card p-4 shadow-xs",
        highlighted ? "border-teal ring-2 ring-teal" : "border-line",
      )}
      data-highlighted={highlighted || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="teal">
          <Icon aria-hidden />
          {EVENT_KIND_LABELS[event.kind]}
        </Badge>
        <span className="text-small text-ink-2">{formatPartialDate(event.date)}</span>
        {conflicts.length > 0 ? (
          <Badge tone="warn">
            <Scale aria-hidden />
            Conflict to discuss
          </Badge>
        ) : null}
      </div>
      <h4 className="m-0 text-lead font-semibold text-ink">{event.title}</h4>
      {who ? <p className="m-0 text-small text-ink-2">{who}</p> : null}
      {event.findings.length > 0 ? (
        <ul className="m-0 grid gap-1 pl-5 text-body text-ink">
          {event.findings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-small text-ink-2">Source: {titles.get(event.sourceDocId) ?? "Unknown record"}</p>
    </motion.li>
  );
}

/** Year rail + events grouped by year. Entrance is staggered and disabled for reduced motion. */
export function HistoryTimelineView({
  events, conflicts, documentTitles, highlightId,
}: {
  events: readonly HistoryEvent[]; conflicts: readonly Conflict[];
  documentTitles: Map<string, string>; highlightId: string | null;
}) {
  const reduced = useReducedMotionGate();
  const groups = useMemo(() => groupByYear(events), [events]);
  const conflictIndex = useMemo(() => conflictEventIndex(conflicts), [conflicts]);
  const order = useMemo(() => new Map(events.map((event, i) => [event.id, i])), [events]);
  if (groups.length === 0) {
    return <p role="status" className="m-0 rounded-md border border-dashed border-line-strong p-6 text-center text-ink-2">No events match these filters.</p>;
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[9rem_1fr]">
      <nav aria-label="Jump to year" className="lg:sticky lg:top-24 lg:self-start">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0 lg:grid lg:gap-1">
          {groups.map((group) => (
            <li key={group.year}>
              <button
                type="button"
                onClick={() => scrollToId(yearAnchorId(group.year), reduced)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm border border-line bg-card px-3 text-small font-semibold text-ink hover:bg-paper-2 focus-ring"
              >
                {group.year}
                <span className="text-ink-2">{group.events.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-8">
        {groups.map((group) => (
          <section key={group.year} id={yearAnchorId(group.year)} aria-label={`${group.year} events`} className="grid scroll-mt-24 gap-3">
            <h3 className="m-0 font-display text-h3 font-light text-ink">{group.year}</h3>
            <ol className="m-0 grid list-none gap-3 border-l border-line-strong p-0 pl-4">
              {group.events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  conflicts={conflictIndex.get(event.id) ?? []}
                  titles={documentTitles}
                  highlighted={highlightId === event.id}
                  index={order.get(event.id) ?? 0}
                  reduced={reduced}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
