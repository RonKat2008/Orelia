import { OutreachNav } from "@/components/outreach/OutreachNav";
import { TrackerBoard } from "@/components/outreach/TrackerBoard";

export default async function TrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav caseId={id} current="tracker">
      <h1>Connection tracker</h1>
      <p className="lede">
        Contacts opened from your shortlist, and tasks when the inbox agent has created them. A task stays open until
        the task approval API confirms it.
      </p>
      <TrackerBoard caseId={id} tasks={[]} />
    </OutreachNav>
  );
}
