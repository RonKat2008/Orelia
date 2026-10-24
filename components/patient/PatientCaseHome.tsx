"use client";

import Link from "next/link";
import { Button, LoadingState, PageHeader, Skeleton } from "@/components/ui";
import { ManageCase } from "@/components/journey/JourneyShell";
import { PatientProgress } from "@/components/shell/PatientProgress";
import { PATIENT_HOME_COPY as COPY } from "./copy";
import { LiveStatus } from "./LiveStatus";
import { NextActionCard } from "./NextActionCard";
import { usePatientStatus } from "./usePatientStatus";
import { WhatsHappened } from "./WhatsHappened";



/**
 * Patient case home (docs/DESIGN-v2.md 7.4): status line, h1, the 4-step line, ONE ActionCard with the next action,
 * the 3 latest things that happened, then "Manage case". Same case data and APIs as the judge pages.
 */
export function PatientCaseHome({ caseId }: { caseId: string }) {
  const { body, error, missing, mode, refresh } = usePatientStatus(caseId);

  if (missing) {
    return (
      <div className="grid max-w-patient gap-6">
        <PageHeader title={COPY.missing.title} lede={COPY.missing.description} className="mb-0" />
        <div>
          <Button asChild size="lg">
            <Link href="/start">{COPY.missing.action}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!body && error) {
    return (
      <div className="grid max-w-patient gap-6">
        <PageHeader title={COPY.loadFailed.title} lede={error} className="mb-0" />
        <div>
          <Button size="lg" onClick={() => void refresh()}>
            {COPY.loadFailed.action}
          </Button>
        </div>
      </div>
    );
  }

  if (!body) {
    return (
      <LoadingState label={COPY.loading} className="max-w-patient">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-56 w-full" />
      </LoadingState>
    );
  }

  const { status, timeline } = body;
  return (
    <div data-testid="patient-home" data-step={status.step} className="grid max-w-patient grid-cols-[minmax(0,1fr)] gap-8">
      <LiveStatus status={status} mode={mode} />
      {error ? (
        <p role="status" className="m-0 -mt-4 text-small text-warn-ink">
          {error}
        </p>
      ) : null}
      <PatientProgress current={status.step} />
      <NextActionCard caseId={caseId} status={status} onDone={refresh} />
      <WhatsHappened items={timeline} seeAllHref={`/cases/${caseId}/tracker`} />
      <ManageCase caseId={caseId} />
    </div>
  );
}
