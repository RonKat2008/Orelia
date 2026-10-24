"use client";

import { useRouter } from "next/navigation";
import { ShortlistPicker } from "../flows/shortlist/ShortlistPicker";
import type { PatientViewProps } from "./types";

/** Patient view of the shortlist page (docs/DESIGN-v2.md 7.6). After the picks are saved, back to the case home. */
export function PatientShortlist({ caseId, titleAs = "h1" }: PatientViewProps) {
  const router = useRouter();
  return (
    <div data-testid="patient-view" data-view-name="Shortlist" data-case-id={caseId}>
      <ShortlistPicker caseId={caseId} layout="page" titleAs={titleAs} onDone={() => router.push(`/cases/${caseId}`)} />
    </div>
  );
}
