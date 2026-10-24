"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { DeleteCaseControl } from "@/components/journey/DeleteCaseControl";
import { LiveStatus } from "./LiveStatus";
import { NextActionCard } from "./NextActionCard";
import { PatientSteps } from "./PatientSteps";
import { usePatientStatus } from "./usePatientStatus";
import { WhatsHappened } from "./WhatsHappened";

/**
 * Patient case home: one live status line, four friendly steps, ONE action card and a short history.
 * Same case data and APIs as the judge pages; agent cards, evidence and scores stay behind "See details".
 */
export function PatientCaseHome({ caseId }: { caseId: string }) {
  const { body, error, missing, mode, refresh } = usePatientStatus(caseId);

  if (missing) {
    return (
      <EmptyState
        icon={<Compass />}
        title="We couldn't find this case"
        description="It may have been removed, or the link may be incomplete."
        action={
          <Button asChild>
            <Link href="/start">Start again</Link>
          </Button>
        }
      />
    );
  }

  if (!body) {
    return (
      <div role="status" aria-busy="true" className="grid gap-8">
        <span className="sr-only">Loading your case</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full max-w-3xl" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const { status, timeline, draft } = body;
  return (
    <div data-testid="patient-home" data-step={status.step} className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-10 sm:gap-12">
      <LiveStatus status={status} mode={mode} />
      {error ? (
        <p role="status" className="m-0 -mt-6 text-small text-warn-ink">
          {error}
        </p>
      ) : null}
      <PatientSteps current={status.step} />
      <NextActionCard caseId={caseId} status={status} draft={draft} onDone={refresh} />
      <WhatsHappened items={timeline} />
      <footer className="grid gap-4 border-t border-line pt-6 text-small text-ink-2 sm:flex sm:items-center sm:justify-between">
        <p className="m-0 max-w-prose">
          Want every detail? The{" "}
          <Link href={`/cases/${caseId}?view=judge`} className="font-semibold text-teal underline decoration-teal/40 underline-offset-4 focus-ring rounded-sm">
            judge view
          </Link>{" "}
          shows each search agent, source and score for this same case.
        </p>
        <DeleteCaseControl caseId={caseId} />
      </footer>
    </div>
  );
}
