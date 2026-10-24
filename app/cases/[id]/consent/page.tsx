import { CasePage } from "@/components/outreach/CasePage";
import { ConsentForm } from "@/components/outreach/ConsentForm";

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    // LANE C SWITCH POINT: patient={<PatientConsent caseId={id} />}
    <CasePage
      eyebrow="Consent"
      title="Choose what each contact sees"
      lede="Everything starts private except your diagnosis. Nothing is sent from this page."
    >
      <ConsentForm caseId={id} />
    </CasePage>
  );
}
