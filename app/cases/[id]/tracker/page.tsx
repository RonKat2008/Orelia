import { OutreachNav } from "@/components/outreach/OutreachNav";
import { TrackerBoard } from "@/components/outreach/TrackerBoard";
import { PREVIEW_CONTACTS, PREVIEW_TASKS } from "@/components/outreach/preview";

export default async function TrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav caseId={id} current="tracker">
      <h1>Connection tracker</h1>
      <p className="lede">
        Every selected contact, its place in the connection sequence, the next follow-up, and tasks that still need
        your approval. Preview data only.
      </p>
      <TrackerBoard contacts={PREVIEW_CONTACTS} tasks={PREVIEW_TASKS} />
    </OutreachNav>
  );
}
