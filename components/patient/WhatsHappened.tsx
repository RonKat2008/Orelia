"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import type { PatientTimelineItem } from "@/lib/patient-status/types";
import { PATIENT_HOME_COPY } from "./copy";
import { latestHappened } from "./home-logic";

const MINUTE = 60_000;
const subscribe = (onChange: () => void) => {
  const id = setInterval(onChange, MINUTE);
  return () => clearInterval(id);
};
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;

export function relativeTime(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.round((now - at) / MINUTE);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The 3 latest things, quiet (done things go quiet, P7), with "See all" to the tracker when there are more. */
export function WhatsHappened({ items, seeAllHref }: { items: PatientTimelineItem[]; seeAllHref?: string }) {
  const now = useSyncExternalStore(subscribe, minuteNow, () => 0);
  const { shown, more } = latestHappened(items);
  const copy = PATIENT_HOME_COPY.happened;
  return (
    <section aria-labelledby="happened-heading" className="grid gap-3">
      <h2 id="happened-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
        {copy.title}
      </h2>
      {shown.length === 0 ? (
        <p className="m-0 text-body text-ink-2">{copy.empty}</p>
      ) : (
        <ol data-testid="patient-timeline" className="m-0 grid list-none gap-0 p-0">
          {shown.map((item) => {
            const when = now ? relativeTime(item.at, now) : null;
            return (
              <li key={item.id} className="flex gap-2 py-2 text-body text-ink-2">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-ok" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {item.text}
                  {when ? <span className="text-ink-3"> · {when}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {more && seeAllHref ? (
        <p className="m-0 text-body">
          <Link
            href={seeAllHref}
            className="rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring"
          >
            {copy.seeAll}
            <span className="sr-only"> {copy.seeAllHidden}</span>
          </Link>
        </p>
      ) : null}
    </section>
  );
}
