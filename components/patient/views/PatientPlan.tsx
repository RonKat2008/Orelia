"use client";

import type { PatientViewProps } from "./types";

/** Patient view of this case page. Stub: the full view lands in a later lane C commit. */
export function PatientPlan({ caseId }: PatientViewProps) {
  return <div data-testid="patient-view" data-view-name="Plan" data-case-id={caseId} />;
}
