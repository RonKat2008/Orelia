import { CasePage } from "@/components/outreach/CasePage";
import { PlanView } from "@/components/plan/PlanView";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    // LANE C SWITCH POINT: patient={<Patient… />}
    <CasePage
      title="How we'll contact them"
      lede="Check how we'll reach each one. Nothing is sent until you read it."
      width="wide"
    >
      <PlanView caseId={id} />
    </CasePage>
  );
}
