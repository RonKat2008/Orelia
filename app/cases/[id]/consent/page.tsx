import { CASE_PAGE_HEADING, CasePage } from "@/components/outreach/CasePage";
import { PatientConsent } from "@/components/patient/views";
import { ConsentForm } from "@/components/outreach/ConsentForm";

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CasePage
      patient={<PatientConsent caseId={id} titleAs={CASE_PAGE_HEADING} />}
      eyebrow="Consent"
      title="Choose what each contact sees"
      lede="Everything starts private except your diagnosis. Nothing is sent from this page."
    >
      <ConsentForm caseId={id} />
    </CasePage>
  );
}
