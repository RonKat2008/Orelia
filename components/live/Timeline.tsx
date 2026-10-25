import { memo } from "react";
import { cn } from "@/lib/ui/cn";
import type { ActivityEvent } from "@/lib/activity/types";
import { KIND_ICON } from "./icons";
import { KIND_LABEL, clockTime } from "./format";

interface TimelineProps {
  /** Newest first. */
  events: ActivityEvent[];
  laneNames: ReadonlyMap<string, string>;
  freshIds: ReadonlySet<string>;
}

function EventRow({ event, laneName, fresh }: { event: ActivityEvent; laneName: string | null; fresh: boolean }) {
  const Icon = KIND_ICON[event.kind];
  return (
    <li className={cn("grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 border-b border-line px-2 py-1.5 last:border-b-0", fresh && "live-new")}>
      <time dateTime={event.at} className="pt-px text-small tabular-nums text-ink-2">{clockTime(event.at)}</time>
      <Icon aria-hidden className="mt-0.5 size-4 text-ink-2" />
      <div className="min-w-0">
        <p className="m-0 break-words text-small text-ink">
          <span className="sr-only">{KIND_LABEL[event.kind]}: </span>
          <span className="font-semibold">{event.title}</span>
          {laneName ? <span className="text-ink-2"> · {laneName}</span> : null}
        </p>
        {event.detail ? <p className="m-0 line-clamp-4 whitespace-pre-wrap break-words text-small text-ink-2">{event.detail}</p> : null}
        {event.imageUrl ? (
          <a href={event.imageUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">
            {/* eslint-disable-next-line @next/next/no-img-element -- same-origin screenshot of the filled form, sized by the browser */}
            <img src={event.imageUrl} alt="Screenshot of the filled form" width={160} height={100} loading="lazy" className="h-auto max-h-24 w-40 max-w-full rounded-sm border border-line object-cover object-top" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

const MemoRow = memo(EventRow);

export function Timeline({ events, laneNames, freshIds }: TimelineProps) {
  if (events.length === 0) {
    return <p className="m-0 p-2 text-small text-ink-2">Nothing has happened yet. Agents, emails, calls and follow-ups show up here as they happen.</p>;
  }
  return (
    <ol aria-label="Activity timeline, newest first" aria-live="polite" aria-relevant="additions" className="m-0 list-none rounded-md border border-line bg-card p-0">
      {events.map((e) => (
        <MemoRow key={e.id} event={e} laneName={e.contactId ? (laneNames.get(e.contactId) ?? null) : null} fresh={freshIds.has(e.id)} />
      ))}
    </ol>
  );
}
