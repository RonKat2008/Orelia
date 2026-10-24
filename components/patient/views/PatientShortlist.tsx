"use client";

import type { PatientViewProps } from "./types";

/** Patient view of this case page. Stub: the full view lands in a later lane C commit. */
export function PatientShortlist({ caseId }: PatientViewProps) {
  return <div data-testid="patient-view" data-view-name="Shortlist" data-case-id={caseId} />;
}
