import { Scale } from "lucide-react";
import { CONFLICT_NOTE, type Conflict } from "@/lib/history/contract";
import { formatPartialDate } from "./model";

/** Neutral side-by-side quotes. Never says which statement is right. */
export function ConflictsPanel({ conflicts }: { conflicts: readonly Conflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <section aria-labelledby="conflicts-heading" className="grid gap-4 border-l-2 border-warn pl-5">
      <header className="grid gap-1">
        <h2 id="conflicts-heading" className="m-0 flex items-center gap-2 font-display text-h3 font-normal text-ink display-soft">
          <Scale aria-hidden className="size-5 text-warn-ink" />
          Conflicts to discuss with your doctor
        </h2>
        <p className="m-0 max-w-prose text-small text-ink-2">{CONFLICT_NOTE}</p>
      </header>
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-4 p-0">
        {conflicts.map((conflict) => (
          <li key={conflict.id} className="grid gap-3 border-b border-line pb-4">
            <p className="m-0 text-body font-semibold text-ink">{conflict.topic}</p>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              {conflict.statements.map((statement) => (
                <figure key={statement.eventId} className="m-0 grid gap-2 rounded-md bg-paper-2 p-3">
                  <blockquote className="m-0 text-body text-ink">&ldquo;{statement.text}&rdquo;</blockquote>
                  <figcaption className="flex flex-wrap items-center gap-2 text-small text-ink-2">
                    <span className="max-w-full break-words">Source: {statement.docTitle}</span>
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
