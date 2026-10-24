"use client";

import { useRouter } from "next/navigation";
import { ConsentFlow } from "../flows/consent/ConsentFlow";
import type { PatientViewProps } from "./types";

/** Patient view of the consent page (docs/DESIGN-v2.md 7.7): one question per page, then back to the case home. */
export function PatientConsent({ caseId, titleAs = "h1" }: PatientViewProps) {
  const router = useRouter();
  return (
    <div data-testid="patient-view" data-view-name="Consent" data-case-id={caseId}>
      <ConsentFlow caseId={caseId} layout="page" titleAs={titleAs} onSaved={() => router.push(`/cases/${caseId}`)} />
    </div>
  );
}
