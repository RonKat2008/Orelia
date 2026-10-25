import { CasePage } from "@/components/outreach/CasePage";
import { EmergencyCardView } from "@/components/rare/emergency/EmergencyCardView";

export default async function EmergencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CasePage
      title="Emergency card"
      lede="One page to show emergency staff. You check it first, then print it or save it."
      width="wide"
    >
      <EmergencyCardView caseId={id} />
    </CasePage>
  );
}
