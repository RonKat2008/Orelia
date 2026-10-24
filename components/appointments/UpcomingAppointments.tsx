"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import { KIND_LABELS } from "@/lib/appointments/schema";
import { loadCaseAppointments, loadMyAppointments } from "./client";
import { countdown, groupAppointments, longDate, type ApptView } from "./model";
import { useNow } from "./use-now";

/**
 * Compact "Upcoming" list for home, account and patient-view surfaces. Without `caseId` it lists every case the
 * viewer owns; with it, one case. Proposed times are flagged "Needs you" and link to the case appointments page.
 */
export function UpcomingAppointments({ caseId, limit = 5, heading = "Upcoming", headingLevel = 2 }: { caseId?: string; limit?: number; heading?: string; headingLevel?: 2 | 3 }) {
  const [list, setList] = useState<ApptView[] | null | "error">(null);
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    void (caseId ? loadCaseAppointments(caseId) : loadMyAppointments()).then((r) => {
      if (!cancelled) setList(r.ok ? r.data.appointments : "error");
    });
    return () => { cancelled = true; };
  }, [caseId]);

  const H = headingLevel === 2 ? "h2" : "h3";
  const title = <H id="upcoming-appts" className="m-0 font-display text-h3 font-normal text-ink display-soft">{heading}</H>;

  if (list === null) {
    return (
      <section aria-labelledby="upcoming-appts" aria-busy="true" className="grid gap-3">
        {title}
        <Skeleton className="h-16 w-full rounded-md" />
      </section>
    );
  }
  if (list === "error") {
    return <section aria-labelledby="upcoming-appts" className="grid gap-3">{title}<p className="m-0 text-small text-ink-2">Appointments could not load.</p></section>;
  }
  const groups = groupAppointments(list, now);
  const items = [...groups.proposed, ...groups.upcoming].slice(0, limit);

  return (
    <section aria-labelledby="upcoming-appts" className="grid gap-4" data-testid="upcoming-appointments">
      {title}
      {items.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title="Nothing scheduled" description="Times offices propose appear here for you to confirm." />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/cases/${a.caseId}/appointments`}
                className="grid gap-1 rounded-md border border-line bg-card p-4 text-ink no-underline shadow-xs focus-ring transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-sm motion-reduce:transition-none"
              >
                <span className="flex flex-wrap items-center gap-2">
                  {a.status === "proposed" ? <Badge tone="gold" dot>Needs you</Badge> : <Badge tone="ok">Confirmed</Badge>}
                  <span className="text-small text-ink-3">{KIND_LABELS[a.kind]}</span>
                  {a.status === "confirmed" && a.startsAt && now > 0 ? <span className="text-small font-semibold text-teal-ink">{countdown(a.startsAt, now)}</span> : null}
                </span>
                <span className="font-semibold">{a.title}</span>
                {a.startsAt ? <span className="text-small text-ink-2">{a.status === "proposed" ? "Proposed: " : ""}{longDate(a.startsAt, a.timezone)}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
