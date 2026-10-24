import { Scale } from "lucide-react";
import { Badge } from "@/components/ui";
import { CONFLICT_NOTE, type Conflict } from "@/lib/history/contract";
import { formatPartialDate } from "./model";

/** Neutral side-by-side quotes. Never says which statement is right. */
export function ConflictsPanel({ conflicts }: { conflicts: readonly Conflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <section aria-labelledby="conflicts-heading" className="grid gap-4 rounded-lg border border-warn/35 bg-warn-soft/50 p-5 sm:p-6">
      <header className="grid gap-1">
        <h3 id="conflicts-heading" className="m-0 flex items-center gap-2 font-display text-h4 font-normal text-ink">
          <Scale aria-hidden className="size-5 text-warn-ink" />
          Conflicts to discuss with your doctor
        </h3>
        <p className="m-0 max-w-prose text-small text-ink-2">{CONFLICT_NOTE}</p>
      </header>
      <ul className="m-0 grid list-none gap-4 p-0">
        {conflicts.map((conflict) => (
          <li key={conflict.id} className="grid gap-3 rounded-md border border-line bg-card p-4">
            <p className="m-0 text-body font-semibold text-ink">{conflict.topic}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {conflict.statements.map((statement) => (
                <figure key={statement.eventId} className="m-0 grid gap-2 rounded-sm bg-paper-2 p-3 shadow-inset">
                  <blockquote className="m-0 text-body text-ink">&ldquo;{statement.text}&rdquo;</blockquote>
                  <figcaption className="flex flex-wrap items-center gap-2 text-small text-ink-2">
                    <Badge tone="outline">Source: {statement.docTitle}</Badge>
                    <span>{formatPartialDate(statement.date)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
