import { OutboxList } from "@/components/outreach/OutboxList";
import { OutreachNav } from "@/components/outreach/OutreachNav";

export default async function OutboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav
      caseId={id}
      current="outbox"
      eyebrow="Waiting for your approval"
      title={
        <>
          Nothing goes out until you <em className="emph">say so</em>
        </>
      }
      lede="Each draft is written only from the details you ticked, and says plainly that an AI helped prepare it. Read it, then approve, change what it shares, or hold it."
    >
      <OutboxList caseId={id} />
    </OutreachNav>
  );
}
