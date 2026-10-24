"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useHydrated } from "@/components/view-mode/useHydrated";
import { useViewMode } from "@/components/view-mode/view-store";
import { AppShell, SiteHeader } from "@/components/shell";
import { CaseMenu } from "@/components/shell/CaseMenu";
import { PATIENT_STEP_FOR_STAGE, PatientProgress } from "@/components/shell/PatientProgress";
import { StageBar } from "@/components/shell/StageBar";
import { BackLink } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/feedback";
import { DeleteCaseControl } from "./DeleteCaseControl";
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

/** Same height as the stage bar, so the page does not jump when the case loads. */
function StageBarSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex h-11 items-center gap-3 border-b border-line">
      <span className="sr-only">Loading case stages</span>
      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
        <Skeleton key={n} className="h-4 w-16 shrink-0" />
      ))}
    </div>
  );
}

/** "Manage case": the quiet home for Delete, away from the next step (docs/DESIGN-v2.md 4.1). */
export function ManageCase({ caseId }: { caseId: string }) {
  return (
    <section aria-label="Manage case" className="mt-16 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6">
      <span className="text-small font-semibold text-ink-2">Manage case</span>
      <DeleteCaseControl caseId={caseId} />
    </section>
  );
}

/**
 * Case shell: one navigation system per view (docs/DESIGN-v2.md 5.2, 5.3).
 * - Patient view: no rail and no stage list. Sub-pages get a back link and the 4-step PatientProgress; the case
 *   home composes its own status line, title and progress.
 * - Judge view: the StageBar (7 stages + Tools) above a wide console.
 * The header carries the case name in its case menu. The shell prints no h1: every page owns its title.
 * Child pages render inside the only <main id="main">.
 */
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

  const pathname = usePathname() ?? `/cases/${caseId}`;
  const hydrated = useHydrated();
  const view = useViewMode();
  const judge = hydrated && view === "judge";
  const home = pathname === `/cases/${caseId}`;
  const caseName = data?.summary?.diseaseName ?? null;

  const header = <SiteHeader cta={null} viewToggle caseMenu={<CaseMenu caseId={caseId} caseName={caseName} />} />;

  if (!judge) {
    const top = home ? null : (
      <div className="grid gap-4">
        <BackLink href={`/cases/${caseId}`}>Back to your case</BackLink>
        {data ? <PatientProgress current={PATIENT_STEP_FOR_STAGE[plan.current]} /> : <Skeleton className="h-8 w-full max-w-patient" />}
      </div>
    );
    return (
      <JourneyContext.Provider value={{ plan, data }}>
        <AppShell mode="patient" header={header} top={top} width={home ? "patient" : "wide"} footer={home ? null : <ManageCase caseId={caseId} />}>
          <div data-journey={plan.current} data-case-id={caseId}>
            {children}
          </div>
        </AppShell>
      </JourneyContext.Provider>
    );
  }

  const top = data && plan.steps.length > 0 ? <StageBar plan={plan} caseId={caseId} pathname={pathname} caseName={caseName} /> : <StageBarSkeleton />;
  return (
    <JourneyContext.Provider value={{ plan, data }}>
      <AppShell mode="judge" header={header} top={top} footer={<ManageCase caseId={caseId} />}>
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
