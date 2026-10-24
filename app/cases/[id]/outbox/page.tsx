import { CASE_PAGE_HEADING, CasePage } from "@/components/outreach/CasePage";
import { PatientOutbox } from "@/components/patient/views";
import { OutboxList } from "@/components/outreach/OutboxList";

export default async function OutboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CasePage
      patient={<PatientOutbox caseId={id} titleAs={CASE_PAGE_HEADING} />}
      eyebrow="Outbox"
      title="Messages to check"
      lede="Each draft uses only the details you ticked. Read it, then approve it or hold it."
    >
      <OutboxList caseId={id} />
    </CasePage>
  );
}
