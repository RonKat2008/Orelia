"use client";

import Link from "next/link";
import { Button, EmptyState, LoadingState, Skeleton } from "@/components/ui";
import { DeleteCaseControl } from "@/components/journey/DeleteCaseControl";
import { PATIENT_HOME_COPY as COPY } from "./copy";
import { LiveStatus } from "./LiveStatus";
import { NextActionCard } from "./NextActionCard";
import { PatientSteps } from "./PatientSteps";
import { usePatientStatus } from "./usePatientStatus";
import { WhatsHappened } from "./WhatsHappened";

const QUIET_LINK =
  "inline-flex min-h-11 items-center rounded-sm text-small font-semibold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink focus-ring";

/** "Manage case": the quiet footer for the judge view link and Delete case (inside its confirm dialog). */
function ManageCase({ caseId }: { caseId: string }) {
  return (
    <footer aria-labelledby="manage-heading" className="grid gap-2 border-t border-line pt-6">
      <h2 id="manage-heading" className="m-0 text-small font-semibold text-ink-2">
        {COPY.manage.title}
      </h2>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href={`/cases/${caseId}?view=judge`} className={QUIET_LINK}>
          {COPY.manage.judgeView}
        </Link>
        <DeleteCaseControl caseId={caseId} className="min-h-11" />
      </div>
    </footer>
  );
}

/**
 * Patient case home (docs/DESIGN-v2.md 7.4): status line, h1, the 4-step line, ONE ActionCard with the next action,
 * the 3 latest things that happened, then "Manage case". Same case data and APIs as the judge pages.
 */
export function PatientCaseHome({ caseId }: { caseId: string }) {
  const { body, error, missing, mode, refresh } = usePatientStatus(caseId);

  if (missing) {
    return (
      <EmptyState
        title={COPY.missing.title}
        description={COPY.missing.description}
        action={
          <Button asChild size="lg">
            <Link href="/start">{COPY.missing.action}</Link>
          </Button>
        }
      />
    );
  }

  if (!body && error) {
    return (
      <EmptyState
        title={COPY.loadFailed.title}
        description={error}
        action={
          <Button size="lg" onClick={() => void refresh()}>
            {COPY.loadFailed.action}
          </Button>
        }
      />
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
      <PatientSteps current={status.step} />
      <NextActionCard caseId={caseId} status={status} onDone={refresh} />
      <WhatsHappened items={timeline} seeAllHref={`/cases/${caseId}/tracker`} />
      <ManageCase caseId={caseId} />
    </div>
  );
}
