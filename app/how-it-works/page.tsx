import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { SiteFooter, SiteHeader } from "@/components/shell";
import {
  HOW_STEPS,
  JUDGE_START_HREF,
  START_HREF,
} from "@/components/landing/content";
import { HowPageAdapts } from "@/components/landing/info/HowPageAdapts";

export const metadata = {
  title: "How Wayfinder works",
  description:
    "Four steps from your report to a real conversation. What we do, and what we never send on our own.",
};

const LINK =
  "inline-flex min-h-11 items-center rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring";

export default function HowItWorksPage() {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main">
        <div className="page-container pt-14 sm:pt-20">
          <PageHeader
            title="How Wayfinder works"
            lede="Four steps, from your report to a real conversation. You approve every message."
            action={
              <Button asChild size="lg">
                <Link href={START_HREF}>Start your case</Link>
              </Button>
            }
          />
        </div>

        <section
          aria-labelledby="steps-heading"
          className="page-container pb-section"
        >
          <h2 id="steps-heading" className="sr-only">
            The four steps
          </h2>
          <ol className="m-0 list-none border-t border-line p-0">
            {HOW_STEPS.map((step, i) => (
              <li
                key={step.id}
                className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-3 border-b border-line py-8 md:grid-cols-[14rem_minmax(0,1fr)]"
              >
                <h3 className="m-0 font-display text-h3 font-light text-ink display-soft">
                  <span className="sr-only">Step {i + 1}: </span>
                  <span aria-hidden>{i + 1}. </span>
                  {step.title}
                </h3>
                <div className="grid max-w-prose gap-3">
                  <p className="m-0 text-body text-ink">{step.body}</p>
                  <p className="m-0 text-small text-ink-2">
                    Behind the scenes: {step.behind}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <HowPageAdapts />

        <section
          aria-labelledby="walkaway-heading"
          className="border-y border-line bg-paper-2"
        >
          <div className="page-container py-section">
            <div className="grid max-w-3xl gap-4">
              <h2
                id="walkaway-heading"
                className="m-0 font-display text-h2 font-light text-balance display-soft"
              >
                You can walk away
              </h2>
              <p className="m-0 max-w-prose text-body text-ink-2">
                You approve follow-ups up front. If nobody answers, we follow up
                on business day 3 and day 7. We tell you when something needs
                you.
              </p>
              <p className="m-0 text-small text-ink-2">
                <Link href="/trust" className={LINK}>
                  What we never do
                </Link>
                <span aria-hidden className="mx-3">
                  ·
                </span>
                <Link href={JUDGE_START_HREF} className={LINK}>
                  For judges: watch the search
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
