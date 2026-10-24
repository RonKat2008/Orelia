import { OutboxList } from "@/components/outreach/OutboxList";
import { OutreachNav } from "@/components/outreach/OutreachNav";

export default async function OutboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav caseId={id} current="outbox">
      <h1>Approve drafts</h1>
      <p className="lede">
        Drafts come from the server and include the AI-assistance disclosure. Approving sends only the draft id. The
        draft is marked approved only after the server confirms. If the outbound gate refuses it, every reason is
        shown and nothing is marked approved.
      </p>
      <OutboxList caseId={id} />
    </OutreachNav>
  );
}
