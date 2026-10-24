"use client";

import type { PatientTrackerProps } from "./types";

/** Patient view of the tracker and threads pages. Stub: the full view lands in a later lane C commit. */
export function PatientTracker({ caseId }: PatientTrackerProps) {
  return <div data-testid="patient-view" data-view-name="Tracker" data-case-id={caseId} />;
}
