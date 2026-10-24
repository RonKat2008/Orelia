import { CasePage } from "@/components/outreach/CasePage";
import { OutboxList } from "@/components/outreach/OutboxList";

export default async function OutboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    // LANE C SWITCH POINT: patient={<PatientOutbox caseId={id} />}
    <CasePage
      eyebrow="Outbox"
      title="Messages to check"
      lede="Each draft uses only the details you ticked. Read it, then approve it or hold it."
    >
      <OutboxList caseId={id} />
    </CasePage>
  );
}
