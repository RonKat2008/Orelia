import { OutreachNav } from "@/components/outreach/OutreachNav";
import { TrackerBoard } from "@/components/outreach/TrackerBoard";
import { followUpScheduler } from "@/lib/workflows/scheduler";

export default async function TrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav
      caseId={id}
      current="tracker"
      eyebrow="Where things stand"
      title={
        <>
          Every <em className="emph">conversation</em>, one calm view
        </>
      }
      lede="What needs you comes first. Below it, each contact's journey from first draft to a real connection."
    >
      <TrackerBoard caseId={id} tasks={[]} schedulingPaused={followUpScheduler() === "none"} />
    </OutreachNav>
  );
}
