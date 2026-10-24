import { AppointmentsPanel } from "@/components/appointments/AppointmentsPanel";
import { PageIntro } from "@/components/shortlist/PageIntro";

export default async function AppointmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <PageIntro
        eyebrow="Appointments"
        title="Visits, consults and calls"
        lede="When an office replies with a time, you confirm it here. Nothing is accepted or sent for you. Prep lists are practical, never medical advice."
      />
      <AppointmentsPanel caseId={id} />
    </div>
  );
}
