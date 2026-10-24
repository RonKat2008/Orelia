import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/shell";

export const metadata = {
  title: "How Wayfinder works",
  description: "What the research and contact agents do, and what they never send on their own.",
};

const STEPS = [
  {
    title: "You share the details",
    body: "Paste a report. Wayfinder pulls out the case fields and asks you to confirm each one before anything runs.",
  },
  {
    title: "A swarm of research agents searches",
    body: "Agents look in public sources at the same time for specialists and centers, recruiting trials, advocacy organizations, and financial or travel aid.",
  },
  {
    title: "Every claim is validated against its source",
    body: "A verifier checks each claim and drops any that has no source. What you see links back to where it came from.",
  },
  {
    title: "You choose, and get a contact plan per resource",
    body: "Pick at most five contacts and tick the case fields that may be shared. For each one, Wayfinder drafts a plan: email, a call, a web-form application, or a combination.",
  },
  {
    title: "Wayfinder reaches out after you approve",
    body: "Nothing goes out until you approve the draft. Then Wayfinder emails, calls, or applies through the web form, and turns replies into tasks you approve.",
  },
  {
    title: "It follows up, and you stay in charge",
    body: "If nobody answers, a follow-up draft appears for your approval. The tracker shows each contact's state and anything still waiting on you.",
  },
];

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
      <main id="main" className="page-container pb-section pt-10 sm:pt-14">
        <div className="mb-12 grid max-w-3xl gap-3 border-b border-line pb-10">
          <p className="m-0 text-micro font-semibold uppercase text-ink-3">How it works</p>
          <h1 className="m-0 max-w-none font-display text-h1 font-light display-soft text-balance">
            From a report to a real conversation
          </h1>
          <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
            Wayfinder looks up specialists, centers, recruiting trials, advocacy groups, and aid, then helps you reach
            the ones you pick. You approve every step.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/start">Start a case</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/trust">What Wayfinder will not do</Link>
            </Button>
          </div>
        </div>

        <section aria-labelledby="agents-heading" className="grid gap-6">
          <h2 id="agents-heading" className="m-0 font-display text-h2 font-light display-soft">
            What happens, in order
          </h2>
          <ol className="m-0 grid max-w-3xl list-none gap-4 p-0">
            {STEPS.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[2.5rem_1fr] gap-4 rounded-lg border border-line bg-card p-5 shadow-sm">
                <span aria-hidden className="grid size-10 place-items-center rounded-full bg-teal-soft font-display text-h4 text-teal">
                  {index + 1}
                </span>
                <div className="grid gap-1">
                  <h3 className="m-0 font-sans text-h4 text-ink">{step.title}</h3>
                  <p className="m-0 text-body text-ink-2">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="limits-heading" className="mt-16 grid gap-6">
          <h2 id="limits-heading" className="m-0 font-display text-h2 font-light display-soft">
            Limits you can count on
          </h2>
          <ul className="m-0 grid max-w-3xl list-disc gap-2 pl-6 text-body text-ink-2 marker:text-teal">
            {LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
