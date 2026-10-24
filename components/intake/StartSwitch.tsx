"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui";
import { useHydrated } from "@/components/view-mode/useHydrated";
import { useViewMode } from "@/components/view-mode/view-store";

/** /start: one question per screen for patients, the detailed intake for judges. Same APIs underneath. */
export function StartSwitch({ patient, judge }: { patient: ReactNode; judge: ReactNode }) {
  const hydrated = useHydrated();
  const view = useViewMode();
  if (!hydrated) {
    return (
      <div role="status" aria-busy="true" className="grid gap-4">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return <>{view === "patient" ? patient : judge}</>;
}
