import { OutboxList } from "@/components/outreach/OutboxList";
import { OutreachNav } from "@/components/outreach/OutreachNav";
import { PREVIEW_CASE, PREVIEW_DRAFTS } from "@/components/outreach/preview";

export default async function OutboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav caseId={id} current="outbox">
      <h1>Approve drafts</h1>
      <p className="lede">
        Each draft shows the AI-assistance disclosure and highlights case fields that consent allows. Approving
        records a timestamp. Nothing is emailed or dialed from this page.
      </p>
      <OutboxList caseId={id} caseRecord={PREVIEW_CASE} drafts={PREVIEW_DRAFTS} />
    </OutreachNav>
  );
}
