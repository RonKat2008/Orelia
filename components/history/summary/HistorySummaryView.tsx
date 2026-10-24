import type { ReactNode } from "react";
import { CONFLICT_NOTE, type Conflict, type HistoryEvent, type HistorySummary, type SummarySection } from "@/lib/history/contract";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/cn";
import { formatPartialDate } from "./format";
import "./summary-print.css";

export interface HistorySummaryViewProps {
  summary: HistorySummary;
  /** Page heading text; rendered as h1 (`titleLevel="h1"`) or h2 when a parent already supplies the h1. */
  title?: ReactNode;
  titleLevel?: "h1" | "h2";
  /** Optional line under the title, e.g. who shared it. */
  intro?: ReactNode;
  /** Actions (print button) shown beside the title; hidden in print. */
  actions?: ReactNode;
  className?: string;
}

function EventItem({ event, sourceTitle }: { event: HistoryEvent; sourceTitle: string }) {
  const where = [event.provider, event.institution].filter(Boolean).join(", ");
  return (
    <li className="hs-event grid gap-1.5 border-l-2 border-sage pl-4">
      <p className="m-0 text-small font-semibold text-ink-2">
        <time>{formatPartialDate(event.date)}</time>
      </p>
      <h4 className="m-0 font-display text-h4 font-normal text-ink display-soft">{event.title}</h4>
      {where ? <p className="m-0 text-small text-ink-2">{where}</p> : null}
      {event.findings.length ? (
        <ul className="m-0 grid list-disc gap-1 pl-5 text-body text-ink">
          {event.findings.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      ) : null}
      <p className="m-0 text-small text-ink-3">Source: {sourceTitle}</p>
    </li>
  );
}

function ConflictItem({ conflict }: { conflict: Conflict }) {
  return (
    <li className="hs-conflict grid gap-2 rounded-md border border-warn/40 bg-warn-soft p-4">
      <h4 className="m-0 font-display text-h4 font-normal text-ink display-soft">{conflict.topic}</h4>
      <ul className="m-0 grid list-none gap-2 p-0">
        {conflict.statements.map((s) => (
          <li key={s.eventId} className="grid gap-0.5">
            <p className="m-0 text-body text-ink">&ldquo;{s.text}&rdquo;</p>
            <p className="m-0 text-small text-ink-2">
              Source: {s.docTitle} ({formatPartialDate(s.date)})
            </p>
          </li>
        ))}
      </ul>
      <p className="m-0 text-small text-warn-ink">{conflict.note || CONFLICT_NOTE}</p>
    </li>
  );
}

function Section({ section, titles }: { section: SummarySection; titles: Map<string, string> }) {
  const headingId = `hs-${section.key}`;
  const count = section.key === "conflicts" ? section.conflicts?.length ?? 0 : section.events.length;
  return (
    <section aria-labelledby={headingId} className="hs-section grid gap-4">
      <h3 id={headingId} className="m-0 flex flex-wrap items-center gap-3 font-display text-h3 font-normal text-ink display-soft">
        {section.label}
        <Badge tone="neutral" size="sm">{count}</Badge>
      </h3>
      {section.key === "conflicts" ? (
        count ? (
          <>
            <p className="m-0 max-w-prose text-body text-ink-2">{CONFLICT_NOTE}</p>
            <ul className="m-0 grid list-none gap-4 p-0">
              {section.conflicts!.map((c) => <ConflictItem key={c.id} conflict={c} />)}
            </ul>
          </>
        ) : <p className="m-0 text-body text-ink-2">No conflicting statements were found in these records.</p>
      ) : count ? (
        <ol className="m-0 grid list-none gap-5 p-0">
          {section.events.map((e) => <EventItem key={e.id} event={e} sourceTitle={titles.get(e.sourceDocId) ?? "Unknown record"} />)}
        </ol>
      ) : <p className="m-0 text-body text-ink-2">Nothing in this category was found in the records.</p>}
    </section>
  );
}

/** Presentational summary shared by the owner's printable page and the public share page. */
export function HistorySummaryView({ summary, title, titleLevel = "h2", intro, actions, className }: HistorySummaryViewProps) {
  const titles = new Map(summary.sources.map((s) => [s.id, s.title]));
  const Title = titleLevel;
  return (
    <article className={cn("hs-root grid gap-8", className)} aria-label="Medical history summary">
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div className="grid gap-2">
            {title ? <Title className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">{title}</Title> : null}
            {intro ? <p className="m-0 max-w-prose text-body text-ink-2">{intro}</p> : null}
            <p className="m-0 text-small text-ink-3">Prepared {formatPartialDate(summary.generatedAt.slice(0, 10))}</p>
          </div>
          {actions}
        </header>
      ) : null}
      <p className="m-0 max-w-prose text-small text-ink-2">{summary.disclaimer}</p>
      {summary.sections.map((s) => <Section key={s.key} section={s} titles={titles} />)}
      <section aria-labelledby="hs-sources" className="hs-section grid gap-2 border-t border-line pt-5">
        <h3 id="hs-sources" className="m-0 font-display text-h4 font-normal text-ink">Records cited</h3>
        {summary.sources.length ? (
          <ul className="m-0 grid list-disc gap-1 pl-5 text-small text-ink-2">
            {summary.sources.map((s) => <li key={s.id}>{s.title}</li>)}
          </ul>
        ) : <p className="m-0 text-small text-ink-2">No records are cited.</p>}
      </section>
    </article>
  );
}
