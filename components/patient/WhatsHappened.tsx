"use client";

import { useSyncExternalStore } from "react";
import type { PatientTimelineItem } from "@/lib/patient-status/types";

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

/** Short plain-language history: "Emailed Stanford Health Care · 2 days ago". */
export function WhatsHappened({ items }: { items: PatientTimelineItem[] }) {
  const now = useSyncExternalStore(subscribe, minuteNow, () => 0);
  return (
    <section aria-labelledby="happened-heading" className="grid gap-4">
      <h2 id="happened-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
        What&apos;s happened
      </h2>
      {items.length === 0 ? (
        <p className="m-0 text-body text-ink-2">Nothing yet. Each step is written down here as it happens.</p>
      ) : (
        <ol data-testid="patient-timeline" className="m-0 grid list-none gap-0 p-0">
          {items.map((item) => {
            const when = now ? relativeTime(item.at, now) : null;
            return (
              <li key={item.id} className="flex gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                <span aria-hidden className="mt-2.5 size-2 shrink-0 rounded-pill bg-teal" />
                <span className="min-w-0 text-body text-ink [overflow-wrap:anywhere]">
                  {item.text}
                  {when ? <span className="text-ink-3"> · {when}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
