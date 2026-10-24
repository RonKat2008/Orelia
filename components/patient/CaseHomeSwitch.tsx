"use client";

import { Skeleton } from "@/components/ui";
import { CaseHome } from "@/components/journey/CaseHome";
import { useHydrated } from "@/components/view-mode/useHydrated";
import { useViewMode } from "@/components/view-mode/view-store";
import { PatientCaseHome } from "./PatientCaseHome";

/** /cases/[id]: the simple patient home or the detailed judge home, over the same case. */
export function CaseHomeSwitch({ caseId }: { caseId: string }) {
  const hydrated = useHydrated();
  const view = useViewMode();
  if (!hydrated) {
    return (
      <div role="status" aria-busy="true" className="grid gap-6">
        <span className="sr-only">Loading your case</span>
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return view === "patient" ? <PatientCaseHome caseId={caseId} /> : <CaseHome caseId={caseId} />;
}
