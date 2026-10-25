import { CoordinateView } from "@/components/coordinate/CoordinateView";
import { CasePage } from "@/components/outreach/CasePage";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function CoordinatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    // LANE C SWITCH POINT: patient={<Patient… />}
    <CasePage
      eyebrow="Care team"
      title="Coordinate your care team"
      lede="We organize and explain. We never give medical advice."
    >
      <CoordinateView caseId={id} />
    </CasePage>
  );
}
