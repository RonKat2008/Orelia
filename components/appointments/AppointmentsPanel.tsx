"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState, LoadingState, PageHeader, Skeleton } from "@/components/ui";
import { AddAppointmentSheet } from "./AddAppointmentSheet";
import { AppointmentCard } from "./AppointmentCard";
import { loadCaseAppointments } from "./client";
import { groupAppointments, type ApptView } from "./model";
import { ProposedAppointmentCard } from "./ProposedAppointmentCard";
import { useNow } from "./use-now";

const CASE_PAGE_HEADING = "h1" as const;

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

  /** Heading level of the page title: h2 while the case shell still prints the h1 (lane A part 2 flips this). */
  const header = (action?: ReactNode) => (
    <PageHeader
      as={CASE_PAGE_HEADING}
      eyebrow="Appointments"
      title="Visits and calls"
      lede="Times offices suggest wait here for you to confirm."
      action={action}
    />
  );

  if (state.status === "loading") {
    return (
      <>
        {header()}
        <LoadingState label="Loading your appointments">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </LoadingState>
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        {header()}
        <p role="alert" className="m-0 border-l-2 border-danger pl-4 text-body text-ink">We could not load your appointments. Refresh to try again.</p>
      </>
    );
  }

  const groups = groupAppointments(state.list, now);
  const [next, ...later] = groups.upcoming;

  return (
    <div className="grid gap-section">
      {header(
        <>
          <AddAppointmentSheet caseId={caseId} onCreated={replace} />
          <Button asChild variant="link" className="min-h-11"><Link href="/calendar">Calendar sync</Link></Button>
        </>,
      )}

      {groups.proposed.length ? (
        <section aria-labelledby="proposed-heading" className="grid gap-6">
          <h2 id="proposed-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">Times to confirm</h2>
          {groups.proposed.map((a, i) => <ProposedAppointmentCard key={a.id} appointment={a} onChange={replace} primary={i === 0} />)}
        </section>
      ) : null}

      <section aria-labelledby="upcoming-heading" className="grid gap-2">
        <h2 id="upcoming-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">Coming up</h2>
        {next ? (
          <div className="grid">
            <AppointmentCard appointment={next} featured onChange={replace} />
            {later.map((a) => <AppointmentCard key={a.id} appointment={a} onChange={replace} />)}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title="No appointments yet"
            description="When an office replies with a time, it shows up here. You can also add one you booked yourself."
          />
        )}
      </section>

      {groups.past.length ? (
        <section aria-labelledby="past-heading" className="grid gap-2">
          <h2 id="past-heading" className="m-0 font-display text-h3 font-normal text-ink-2 display-soft">Earlier and cancelled</h2>
          {groups.past.map((a) => <AppointmentCard key={a.id} appointment={a} onChange={replace} />)}
        </section>
      ) : null}
    </div>
  );
}
