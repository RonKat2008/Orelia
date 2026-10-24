import Link from "next/link";
import { ArrowRight, BellRing, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { START_HREF } from "@/components/landing/content";
import { HowPageAdapts } from "@/components/landing/info/HowPageAdapts";
import { HowPageSteps } from "@/components/landing/info/HowPageSteps";

export const metadata = {
  title: "How Wayfinder works",
  description: "What the research and contact agents do, and what they never send on their own.",
};

const LIMITS = [
  "Every claim shown about a resource links to its source.",
  "Nothing is sent unless you approve it, and a message includes only the fields you tick.",
  "A case can have at most five active contacts.",
  "Every outbound email, and the start of every call, says that AI assistance was used.",
  "Wayfinder coordinates contact. It does not interpret reports or give medical advice.",
  "In this demo, sending is test-only. Messages go only to inboxes and phone numbers we own.",
];

export default function HowItWorksPage() {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main">
        <header className="grain relative overflow-hidden">
          <div className="page-container grid grid-cols-[minmax(0,1fr)] gap-6 pb-section pt-14 sm:pt-20">
            <p className="m-0 text-micro font-semibold uppercase text-ink-3">How it works</p>
            <h1 className="m-0 max-w-4xl font-display text-display font-light text-balance display-soft">
              From a report to a real <em className="emph">conversation</em>.
            </h1>
            <p className="m-0 max-w-prose text-lead text-pretty text-ink-2">
              Wayfinder looks up specialists, centers, recruiting trials, advocacy groups, and aid, then helps you reach
              the ones you pick. You approve every step.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button asChild size="lg">
                <Link href={START_HREF}>Start a case</Link>
              </Button>
              <Link
                href="/trust"
                className="inline-flex items-center gap-2 rounded-sm text-body font-semibold text-teal no-underline underline-offset-4 hover:text-teal-ink hover:underline focus-ring"
              >
                What Wayfinder will not do
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
          </div>
        </header>

        <HowPageSteps />
        <HowPageAdapts />

        <section aria-labelledby="followup-heading" className="page-container pb-section">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 rounded-lg border border-line bg-card p-6 shadow-md sm:p-10 lg:grid-cols-12 lg:gap-12">
            <div className="grid min-w-0 content-start gap-4 lg:col-span-7">
              <p className="m-0 text-micro font-semibold uppercase text-teal">Walk away</p>
              <h2 id="followup-heading" className="m-0 font-display text-h2 font-light text-balance display-soft">
                You can walk away. It keeps <em className="emph">following up</em>.
              </h2>
              <p className="m-0 max-w-prose text-body text-ink-2">
                Follow-ups are approved up front. If nobody answers, agents follow up on business day 3 and day 7, and the tracker
                shows each contact&rsquo;s state and anything still waiting on you.
              </p>
            </div>
            <ul className="m-0 grid min-w-0 list-none content-center gap-4 p-0 lg:col-span-5">
              {[
                { Icon: CalendarClock, text: "Business day 3 and day 7 follow-ups, pre-approved by you." },
                { Icon: BellRing, text: "You are notified when something needs you." },
              ].map(({ Icon, text }) => (
                <li key={text} className="flex items-center gap-4 rounded-md border border-line bg-paper-2 p-4">
                  <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-md border border-line bg-card text-teal shadow-xs">
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 text-body text-ink">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="limits-heading" className="border-t border-line bg-paper-2">
          <div className="page-container grid grid-cols-[minmax(0,1fr)] gap-8 py-section lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-4">
              <p className="m-0 text-micro font-semibold uppercase text-ink-3">Limits</p>
              <h2 id="limits-heading" className="m-0 mt-4 font-display text-h2 font-light text-balance display-soft">
                Limits you can <em className="emph">count</em> on.
              </h2>
            </div>
            <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-x-10 p-0 sm:grid-cols-2 lg:col-span-8">
              {LIMITS.map((limit) => (
                <li key={limit} className="min-w-0 border-t border-line-strong py-4 text-body text-ink-2">
                  {limit}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="how-cta-heading" className="page-container py-section">
          <div className="grain relative overflow-hidden rounded-lg border border-line bg-card px-6 py-14 shadow-xl sm:px-12 lg:px-16">
            <h2 id="how-cta-heading" className="m-0 max-w-2xl font-display text-h1 font-light text-balance display-soft">
              Ready to knock on every <em className="emph">door</em>?
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
              <Button asChild size="lg">
                <Link href={START_HREF}>Start your case</Link>
              </Button>
              <p className="m-0 text-small text-ink-2">Nothing is sent until you approve it.</p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
