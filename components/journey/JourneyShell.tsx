"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { JourneyStepper } from "./JourneyStepper";
import { loadJourney, type JourneyData } from "./load";
import { resolveJourney, type JourneyPlan } from "./model";
import { LoadingSkeleton } from "@/components/threads/states";
import "./journey.css";

const waiting: JourneyPlan = {
  current: "intake",
  steps: [],
  nextLabel: "Finish intake",
  nextHref: "/",
  notes: [],
};

const JourneyContext = createContext<{ plan: JourneyPlan; data: JourneyData | null }>({
  plan: waiting,
  data: null,
});

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
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  return (
    <JourneyContext.Provider value={{ plan, data }}>
      <div className="journey" data-journey={plan.current} data-case-id={caseId}>
        {data ? (
          plan.steps.length > 0 ? <JourneyStepper plan={plan} /> : null
        ) : (
          <LoadingSkeleton label="Loading case progress" />
        )}
        {children}
      </div>
    </JourneyContext.Provider>
  );
}

export function useJourney(): { plan: JourneyPlan; data: JourneyData | null } {
  return useContext(JourneyContext);
}
