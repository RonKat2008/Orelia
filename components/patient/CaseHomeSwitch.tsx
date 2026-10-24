"use client";

import { LoadingState, Skeleton } from "@/components/ui";
import { CaseHome } from "@/components/journey/CaseHome";
import { useHydrated } from "@/components/view-mode/useHydrated";
import { useViewMode } from "@/components/view-mode/view-store";
import { PATIENT_HOME_COPY } from "./copy";
import { PatientCaseHome } from "./PatientCaseHome";

/** /cases/[id]: the simple patient home or the detailed judge home, over the same case. */
export function CaseHomeSwitch({ caseId }: { caseId: string }) {
  const hydrated = useHydrated();
  const view = useViewMode();
  if (!hydrated) {
    return (
      <LoadingState label={PATIENT_HOME_COPY.loading} className="max-w-patient">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-56 w-full" />
      </LoadingState>
    );
  }
  return view === "patient" ? <PatientCaseHome caseId={caseId} /> : <CaseHome caseId={caseId} />;
}
