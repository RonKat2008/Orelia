"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui";
import { loadCaseAppointments } from "./client";

/** One-line banner on outreach screens when a reply proposed a time the patient has not confirmed yet. */
export function ProposedAppointmentsNotice({ caseId }: { caseId: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void loadCaseAppointments(caseId).then((r) => {
      if (!cancelled && r.ok) setCount(r.data.appointments.filter((a) => a.status === "proposed").length);
    });
    return () => { cancelled = true; };
  }, [caseId]);
  if (!count) return null;
  return (
    <Link
      href={`/cases/${caseId}/appointments`}
      data-testid="proposed-appointments-notice"
      className="flex flex-wrap items-center gap-3 border-l-2 border-gold py-2 pl-4 text-ink no-underline focus-ring motion-reduce:transition-none"
    >
      <Badge tone="warn" dot>Needs you</Badge>
      <CalendarClock aria-hidden className="size-4 text-ink-2" />
      <span className="font-semibold">{count === 1 ? "An office proposed a time." : `${count} proposed times are waiting.`}</span>
      <span className="text-small text-ink-2 underline decoration-ink-3/40 underline-offset-4">Review and confirm</span>
    </Link>
  );
}
