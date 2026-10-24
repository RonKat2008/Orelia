"use client";

import { useEffect, useState } from "react";
import type { HistoryTimeline, HistorySummary } from "@/lib/history/contract";
import { ALL_SHARE_SECTIONS, buildSummary } from "@/lib/history/summary";
import { Skeleton } from "@/components/ui/feedback";
import { LoadingState } from "@/components/ui/states";
import { HistorySummaryView } from "./HistorySummaryView";
import { PrintButton } from "./PrintButton";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; summary: HistorySummary };

/** Owner-only: loads the timeline through the guarded API and shows every section, ready to print. */
export function PrintableSummary({ caseId }: { caseId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cases/${caseId}/history`)
      .then((r) => (r.ok ? (r.json() as Promise<{ timeline: HistoryTimeline }>) : Promise.reject(new Error(String(r.status)))))
      .then(({ timeline }) => {
        if (!cancelled) setState({ status: "ready", summary: buildSummary(timeline, ALL_SHARE_SECTIONS, new Date()) });
      })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, [caseId]);

  if (state.status === "loading") {
    return (
      <LoadingState label="Loading your summary">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </LoadingState>
    );
  }
  if (state.status === "error") {
    return <p role="alert" className="m-0 text-body text-danger">We could not load your summary. Reload the page to try again.</p>;
  }
  return <HistorySummaryView summary={state.summary} title="Medical history summary" actions={<PrintButton />} />;
}
