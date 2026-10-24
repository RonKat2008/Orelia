"use client";

import Link from "next/link";
import { useState } from "react";
import { Compass } from "lucide-react";
import { Button, EmptyState, List, ListRow, LoadingState, PageHeader, Progress, Skeleton, toast } from "@/components/ui";
import { usePatientStatus } from "../usePatientStatus";
import { SEARCH_COPY as copy } from "./search/copy";
import { foundCount, searchPhase, searchRows, sourceTotal } from "./search/model";
import type { PatientViewProps } from "./types";

function SearchLoading() {
  return (
    <LoadingState label={copy.loading} className="max-w-patient">
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-14 w-full" />
    </LoadingState>
  );
}

function RetryAction({ caseId, onDone }: { caseId: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function retry() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/cases/${caseId}/research`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    toast.success(copy.retrying);
    await onDone();
    setBusy(false);
  }
  return (
    <div className="grid gap-3">
      {failed ? <p role="alert" className="m-0 text-small text-ink">{copy.retryFailed}</p> : null}
      <Button size="lg" loading={busy} loadingText={copy.retryBusy} onClick={() => void retry()}>
        {copy.retry}
      </Button>
    </div>
  );
}

/** Patient view of the search (docs/DESIGN-v2.md 7.5): reassure while we look, then one button to the shortlist. */
export function PatientSearch({ caseId, titleAs = "h1" }: PatientViewProps) {
  const { body, error, missing, refresh } = usePatientStatus(caseId);

  if (missing) {
    return (
      <div className="max-w-patient">
        <EmptyState
          icon={<Compass />}
          title={copy.missingTitle}
          description={copy.missingBody}
          action={<Button asChild><Link href="/start">{copy.missingLink}</Link></Button>}
        />
      </div>
    );
  }
  if (!body && error) {
    return (
      <div className="max-w-patient">
        <EmptyState icon={<Compass />} title={copy.errorTitle} description={error} action={<Button onClick={() => void refresh()}>{copy.errorRetry}</Button>} />
      </div>
    );
  }
  if (!body) return <SearchLoading />;

  const { status, timeline } = body;
  const phase = searchPhase(status);

  if (phase === "failed") {
    return (
      <div className="max-w-patient">
        <EmptyState title={copy.failedTitle} description={copy.failedBody} action={<RetryAction caseId={caseId} onDone={refresh} />} />
      </div>
    );
  }
  if (phase === "none" || phase === "not_started") {
    const none = phase === "none";
    return (
      <div className="max-w-patient">
        <EmptyState
          title={none ? copy.noneTitle : copy.emptyTitle}
          description={none ? copy.noneBody : copy.emptyBody}
          action={<Button asChild variant="link"><Link href={`/cases/${caseId}`}>{copy.emptyLink}</Link></Button>}
        />
      </div>
    );
  }

  const done = phase === "done";
  const total = sourceTotal(status);
  const rows = searchRows(status, timeline, phase);
  const progress = status.progress ?? (done ? { done: total, total } : { done: 0, total });
  const progressName = copy.progressName(progress.done, progress.total);

  return (
    <div data-testid="patient-search" data-phase={phase} className="grid max-w-patient gap-8">
      <PageHeader
        as={titleAs}
        className="mb-0"
        title={done ? copy.titleDone(foundCount(status, timeline)) : copy.titleSearching(total)}
        lede={done ? copy.ledeDone : copy.lede}
      />
      {!done ? <Progress value={progress.done} max={progress.total} aria-label={progressName} valueText={progressName} /> : null}
      {rows.length > 0 ? (
        <List label="What we're doing">
          {rows.map((text) => (
            <ListRow key={text} title={<span className="font-normal text-ink-2">{text}</span>} />
          ))}
        </List>
      ) : null}
      {done ? (
        <div>
          <Button asChild size="lg">
            <Link href={`/cases/${caseId}/shortlist`}>{copy.primary}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
