import { IntakeFlow } from "@/components/intake/IntakeFlow";
import { PatientIntake } from "@/components/intake/patient/PatientIntake";
import { StartSwitch } from "@/components/intake/StartSwitch";
import { loadDemoReports } from "@/components/intake/demos";
import { SiteFooter, SiteHeader } from "@/components/shell";

export const metadata = {
  title: "Start your case",
  description:
    "Share a report, confirm the details, and Wayfinder looks for specialists, trials, advocacy groups, and aid.",
};

export default function StartPage() {
  const demos = loadDemoReports();
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader cta={null} viewToggle />
      <main id="main" className="page-container pb-section pt-10 sm:pt-14">
        <StartSwitch
          patient={
            <div className="min-w-0 max-w-patient [&_input]:min-w-0 [&_input]:max-w-full [&_label]:min-w-0">
              <PatientIntake demos={demos} />
            </div>
          }
          judge={
            // Intake grids use auto tracks; pin them to the container so long report text cannot widen the page.
            <div className="min-w-0 [&_.stack]:grid-cols-[minmax(0,1fr)] [&_input]:min-w-0 [&_input]:max-w-full [&_label]:min-w-0">
              <IntakeFlow demos={demos} />
            </div>
          }
        />
      </main>
      <SiteFooter />
    </div>
  );
}
