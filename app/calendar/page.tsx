import { SiteFooter, SiteHeader } from "@/components/shell";
import { PageHeader } from "@/components/ui";
import { CalendarSettings } from "@/components/appointments/CalendarSettings";
import { UpcomingAppointments } from "@/components/appointments/UpcomingAppointments";

export const metadata = {
  title: "Appointments and calendar",
  description: "Your upcoming appointments across cases, and private calendar sync.",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const google = typeof params.google === "string" ? params.google : undefined;
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main">
        <div className="page-container py-8">
          <PageHeader
            title="Your appointments"
            lede="Times offices suggest wait for you to confirm. Confirmed ones get reminders and can sync to your calendar."
            className="mb-6"
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
            <UpcomingAppointments limit={8} />
            <CalendarSettings googleResult={google} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
