import { IntakeFlow } from "@/components/intake/IntakeFlow";
import { PatientIntake } from "@/components/intake/patient/PatientIntake";
import { StartSwitch } from "@/components/intake/StartSwitch";
import { loadDemoReports } from "@/components/intake/demos";
import Link from "next/link";
import { SiteHeader } from "@/components/shell";

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
      <main id="main" className="page-container pb-6 pt-4 sm:pt-8">
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
      <footer className="page-container border-t border-line py-4 text-small text-ink-2">
        <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Wayfinder never gives medical advice. In an emergency call 911.</span>
          <Link href="/how-it-works" className="inline-flex min-h-11 items-center rounded-sm text-ink underline underline-offset-4 focus-ring">How it works</Link>
          <Link href="/trust" className="inline-flex min-h-11 items-center rounded-sm text-ink underline underline-offset-4 focus-ring">Trust and safety</Link>
        </p>
      </footer>
    </div>
  );
}
