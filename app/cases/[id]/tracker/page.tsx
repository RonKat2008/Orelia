import { ProposedAppointmentsNotice } from "@/components/appointments/ProposedAppointmentsNotice";
import { CasePage } from "@/components/outreach/CasePage";
import { TrackerBoard } from "@/components/outreach/TrackerBoard";
import { followUpScheduler } from "@/lib/workflows/scheduler";

export default async function TrackerPage({
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
    <CasePage title="Replies and follow-ups" lede="See who answered, what they asked for, and when we follow up next." eyebrow="Tracker">
      {/* LANE C SWITCH POINT: patient={<PatientTracker… />} ("Who we've contacted") */}
      <ProposedAppointmentsNotice caseId={id} />
      <TrackerBoard caseId={id} tasks={[]} schedulingPaused={followUpScheduler() === "none"} focusContactId={contact} />
    </CasePage>
  );
}
