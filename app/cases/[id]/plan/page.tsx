import { CASE_PAGE_HEADING, CasePage } from "@/components/outreach/CasePage";
import { PatientPlan } from "@/components/patient/views";
import { PlanView } from "@/components/plan/PlanView";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CasePage
      patient={<PatientPlan caseId={id} titleAs={CASE_PAGE_HEADING} />}
      title="How we'll contact them"
      lede="Check how we'll reach each one. Nothing is sent until you read it."
      width="judge"
    >
      <PlanView caseId={id} />
    </CasePage>
  );
}
