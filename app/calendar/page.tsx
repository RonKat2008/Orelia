import { SiteFooter, SiteHeader } from "@/components/shell";
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
        <header className="grain relative">
          <div className="page-container grid gap-4 pb-10 pt-14 sm:pt-20">
            <p className="m-0 text-micro font-semibold uppercase text-ink-3">Appointments</p>
            <h1 className="m-0 max-w-4xl font-display text-h1 font-light text-balance display-soft">Every visit, on the calendar you already use.</h1>
            <p className="m-0 max-w-prose text-lead text-pretty text-ink-2">
              Times offices propose wait here for you to confirm. Confirmed ones get reminders and can sync to your calendar.
            </p>
          </div>
        </header>
        <div className="page-container grid gap-section pb-section">
          <UpcomingAppointments limit={8} />
          <section aria-labelledby="sync-heading" className="grid gap-5">
            <h2 id="sync-heading" className="sr-only">Calendar sync</h2>
            <CalendarSettings googleResult={google} />
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
