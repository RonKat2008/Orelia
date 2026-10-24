"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { AddAppointmentSheet } from "./AddAppointmentSheet";
import { AppointmentCard } from "./AppointmentCard";
import { loadCaseAppointments } from "./client";
import { groupAppointments, type ApptView } from "./model";
import { ProposedAppointmentCard } from "./ProposedAppointmentCard";
import { useNow } from "./use-now";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; list: ApptView[] };

/** Case appointments: proposed times that need the patient first, then what is coming up, then the rest. */
export function AppointmentsPanel({ caseId }: { caseId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    void loadCaseAppointments(caseId).then((r) => {
      if (!cancelled) setState(r.ok ? { status: "ready", list: r.data.appointments } : { status: "error" });
    });
    return () => { cancelled = true; };
  }, [caseId]);

  const replace = (next: ApptView) =>
    setState((s) => (s.status === "ready" ? { status: "ready", list: s.list.some((a) => a.id === next.id) ? s.list.map((a) => (a.id === next.id ? next : a)) : [...s.list, next] } : s));

  if (state.status === "loading") {
    return (
      <div role="status" aria-busy="true" className="grid gap-4">
        <span className="sr-only">Loading appointments</span>
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }
  if (state.status === "error") {
    return <p role="alert" className="m-0 rounded-md border border-danger/30 bg-danger-soft p-4 text-body text-ink">Appointments could not load. Refresh to try again.</p>;
  }

  const groups = groupAppointments(state.list, now);
  const [next, ...later] = groups.upcoming;

  return (
    <div className="grid gap-section">
      {groups.proposed.length ? (
        <section aria-labelledby="proposed-heading" className="grid gap-5">
          <h3 id="proposed-heading" className="m-0 text-h4 font-bold text-ink">Times to confirm</h3>
          {groups.proposed.map((a) => <ProposedAppointmentCard key={a.id} appointment={a} onChange={replace} />)}
        </section>
      ) : null}

      <section aria-labelledby="upcoming-heading" className="grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h3 id="upcoming-heading" className="m-0 font-display text-h2 font-light text-ink display-soft">Coming up</h3>
          <div className="flex flex-wrap gap-2">
            <AddAppointmentSheet caseId={caseId} onCreated={replace} />
            <Button asChild variant="ghost"><Link href="/calendar">Calendar sync</Link></Button>
          </div>
        </div>
        {next ? (
          <div className="grid gap-4">
            <AppointmentCard appointment={next} featured onChange={replace} />
            {later.map((a) => <AppointmentCard key={a.id} appointment={a} onChange={replace} />)}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title="No appointments yet"
            description="When an office replies with a time, it shows up here for you to confirm. You can also add one you booked yourself."
          />
        )}
      </section>

      {groups.past.length ? (
        <section aria-labelledby="past-heading" className="grid gap-4">
          <h3 id="past-heading" className="m-0 text-h4 font-bold text-ink-2">Earlier and cancelled</h3>
          {groups.past.map((a) => <AppointmentCard key={a.id} appointment={a} onChange={replace} />)}
        </section>
      ) : null}
    </div>
  );
}
