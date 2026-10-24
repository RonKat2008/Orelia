import { IntakeFlow } from "@/components/intake/IntakeFlow";
import { loadDemoReports } from "@/components/intake/demos";
import { SiteFooter, SiteHeader } from "@/components/shell";

export const metadata = {
  title: "Start your case",
  description: "Share a report, confirm the details, and Wayfinder looks for specialists, trials, advocacy groups, and aid.",
};

const JOURNEY = ["Share a report", "Confirm the details", "Nine searches run at once", "You choose who to contact"];

export default function StartPage() {
  const demos = loadDemoReports();
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader cta={null} />
      <main id="main" className="page-container pb-section pt-10 sm:pt-14">
        <div className="mb-10 grid max-w-3xl gap-3">
          <p className="m-0 text-micro font-semibold uppercase text-ink-3">Find the right door</p>
          <h1 className="m-0 max-w-none font-display text-h1 font-light display-soft text-balance">
            Tell us about the case
          </h1>
          <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
            Wayfinder reads a report, then looks for specialists, centers, trials, advocacy groups, and aid. You confirm
            every field before research starts.
          </p>
          <ol
            aria-label="How Wayfinder works"
            className="m-0 mt-2 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-small font-semibold text-ink-2"
          >
            {JOURNEY.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <span aria-hidden className="grid size-6 place-items-center rounded-full bg-teal-soft text-micro text-teal">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <IntakeFlow demos={demos} />
      </main>
      <SiteFooter />
    </div>
  );
}
