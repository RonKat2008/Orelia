import { AppointmentsPanel } from "@/components/appointments/AppointmentsPanel";

export default async function AppointmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <AppointmentsPanel caseId={id} />
    </div>
  );
}
