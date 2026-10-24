"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useHydrated } from "@/components/view-mode/useHydrated";
import { useViewMode } from "@/components/view-mode/view-store";
import { AppShell, CASE_NAV } from "@/components/shell";
import { Skeleton } from "@/components/ui/feedback";
import { DeleteCaseControl } from "./DeleteCaseControl";
import { JourneyStepper } from "./JourneyStepper";
import { loadJourney, type JourneyData } from "./load";
import { resolveJourney, type JourneyPlan } from "./model";

const waiting: JourneyPlan = {
  current: "intake",
  steps: [],
  nextLabel: "Finish your case",
  nextHref: "/start",
  documentsHref: "/cases/pending/documents",
  historyHref: "/cases/pending/history",
  expertsHref: "/cases/pending/experts",
  researchHref: "/cases/pending/research",
  notes: [],
};

const JourneyContext = createContext<{ plan: JourneyPlan; data: JourneyData | null }>({
  plan: waiting,
  data: null,
});

function RailSkeleton() {
  return (
    <div role="status" aria-busy="true" className="grid gap-4">
      <span className="sr-only">Loading case progress</span>
      <Skeleton className="h-2 w-full" />
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <div key={n} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-pill" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Case shell: AppShell with the journey rail. Child pages render inside <main id="main">. */
export function JourneyShell({ caseId, children }: { caseId: string; children: ReactNode }) {
  const [plan, setPlan] = useState<JourneyPlan>(waiting);
  const [data, setData] = useState<JourneyData | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadJourney(caseId).then((loaded) => {
      if (cancelled) return;
      setData(loaded);
      setPlan(
        resolveJourney(caseId, {
          status: loaded.status,
          selectedCount: loaded.selectedCount,
          openTaskCount: loaded.openTaskCount,
          contacts: loaded.contacts,
          planStatus: loaded.planStatus,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const sidebar = data ? (
    <>
      {plan.steps.length > 0 ? <JourneyStepper plan={plan} /> : null}
      <DeleteCaseControl caseId={caseId} />
    </>
  ) : (
    <RailSkeleton />
  );

  // Patient view on the case home: no rail and no title block; the live status line is the page heading.
  const pathname = usePathname();
  const hydrated = useHydrated();
  const view = useViewMode();
  const simple = pathname === `/cases/${caseId}` && (!hydrated || view === "patient");
  if (simple) {
    return (
      <JourneyContext.Provider value={{ plan, data }}>
        <AppShell nav={CASE_NAV} viewToggle>
          <div data-journey={plan.current} data-case-id={caseId} data-view="patient">
            {children}
          </div>
        </AppShell>
      </JourneyContext.Provider>
    );
  }

  return (
    <JourneyContext.Provider value={{ plan, data }}>
      <AppShell nav={CASE_NAV} sidebar={sidebar} title={data?.summary?.diseaseName ?? "Your case"} viewToggle>
        <div data-journey={plan.current} data-case-id={caseId}>
          {children}
        </div>
      </AppShell>
    </JourneyContext.Provider>
  );
}

export function useJourney(): { plan: JourneyPlan; data: JourneyData | null } {
  return useContext(JourneyContext);
}
