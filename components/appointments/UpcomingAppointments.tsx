"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Badge, EmptyState, List, ListRow, Skeleton } from "@/components/ui";
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
        <List>
          {items.map((a) => (
            <ListRow
              key={a.id}
              href={`/cases/${a.caseId}/appointments`}
              title={a.title}
              meta={[
                KIND_LABELS[a.kind],
                a.startsAt ? `${a.status === "proposed" ? "Proposed: " : ""}${longDate(a.startsAt, a.timezone)}` : null,
              ].filter(Boolean).join(" · ")}
              badges={a.status === "proposed" ? [<Badge key="n" tone="warn" dot>Needs you</Badge>] : undefined}
              trailing={a.status === "confirmed" && a.startsAt && now > 0 ? <span className="font-semibold text-teal-ink">{countdown(a.startsAt, now)}</span> : undefined}
            />
          ))}
        </List>
      )}
    </section>
  );
}
