import { CasePage } from "@/components/outreach/CasePage";
import { TrackerBoard } from "@/components/outreach/TrackerBoard";
import { followUpScheduler } from "@/lib/workflows/scheduler";

/**
 * Deep link into the tracker console with one conversation open (docs/DESIGN-v2.md 7.10: threads merged into the
 * tracker's detail pane). ?contact= picks the contact.
 */
export default async function ThreadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ contact?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const contact = typeof query.contact === "string" ? query.contact : null;
  return (
    <CasePage title="Replies and follow-ups" lede="The whole conversation with each contact, in order." eyebrow="Conversation">
      {/* LANE C SWITCH POINT: patient={<PatientTracker… />} ("Who we've contacted") */}
      <TrackerBoard caseId={id} tasks={[]} schedulingPaused={followUpScheduler() === "none"} focusContactId={contact} />
    </CasePage>
  );
}
