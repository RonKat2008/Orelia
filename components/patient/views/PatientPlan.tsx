"use client";

import { useRouter } from "next/navigation";
import { PlanView } from "../flows/plan/PlanView";
import type { PatientViewProps } from "./types";

/** Patient view of the plan page: plain rows and "OK this plan", then back to the case home. */
export function PatientPlan({ caseId, titleAs = "h1" }: PatientViewProps) {
  const router = useRouter();
  return (
    <div data-testid="patient-view" data-view-name="Plan" data-case-id={caseId}>
      <PlanView caseId={caseId} layout="page" titleAs={titleAs} onDone={() => router.push(`/cases/${caseId}`)} />
    </div>
  );
}
