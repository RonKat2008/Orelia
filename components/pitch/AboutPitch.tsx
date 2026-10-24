import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    id: "case",
    label: "Your case",
    text: "Paste a report. You check the extracted fields before anything else runs.",
  },
  {
    id: "swarm",
    label: "Research swarm",
    text: "Nine research agents look in public sources at the same time and stream their progress.",
  },
  {
    id: "shortlist",
    label: "Sourced shortlist",
    text: "You get a shortlist grouped by kind of help. Each reason links to its source.",
  },
  {
    id: "approve",
    label: "You approve",
    text: "You pick at most five contacts, tick the fields that may be shared, and approve each draft.",
  },
  {
    id: "outreach",
    label: "Email or call",
    text: "Approved plans go to intake teams by email, a call that starts with an AI disclosure, or a web-form application.",
  },
  {
    id: "tasks",
    label: "Replies as tasks",
    text: "Replies become tasks (send slides, get a referral, call to schedule) and you decide what happens next.",
  },
  {
    id: "follow",
    label: "Follow-up",
    text: "If nobody answers, a follow-up draft appears on business day 3 and again on day 7. Wayfinder does not send it on its own.",
  },
] as const;

const PROMISES = [
  {
    id: "advice",
    title: "No medical advice",
    text: "Wayfinder finds people and programs and helps you reach them. It does not interpret a report, recommend a treatment, or rank therapies. If you have new or worsening symptoms, contact your care team or call 911.",
  },
  {
    id: "sources",
    title: "Every claim has a source",
    text: "A verifier drops anything that does not come from a public source. You can open that source yourself.",
  },
  {
    id: "approval",
    title: "You approve every send",
    text: "Drafts wait for you. A message includes only the case fields you tick, and a case keeps at most five active contacts.",
  },
  {
    id: "disclosure",
    title: "The outreach says it used AI",
    text: "Every email, and the start of every call, discloses that AI assistance was used.",
  },
  {
    id: "demo",
    title: "The demo stays on test inboxes",
    text: "Nothing in the demo is sent to a real hospital, clinician, organization, or phone number. Outbound mail is limited to test addresses we own.",
  },
] as const;

const KICKER =
  "m-0 flex items-center gap-2.5 text-micro font-semibold uppercase text-ink-2";

export function AboutPitch() {
  return (
    <>
      <section aria-labelledby="about-heading" className="border-b border-line">
        <div className="page-container grid grid-cols-[minmax(0,1fr)] gap-y-8 pb-section pt-12 sm:pt-16 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:col-span-9 xl:col-span-8">
            <p className={KICKER}>
              <span aria-hidden className="h-px w-8 bg-terracotta" />
              About
            </p>
            <h1
              id="about-heading"
              className="m-0 mt-5 font-display text-display font-light text-balance text-ink display-soft"
            >
              Expert finders tell you who the expert is. Wayfinder gets you{" "}
              <em className="emph">seen</em>.
            </h1>
            <p className="m-0 mt-8 max-w-[40rem] text-lead text-pretty text-ink-2">
              You bring a case. A research swarm looks up specialists and
              centers, recruiting trials, advocacy groups, and financial or
              travel aid, and every claim is validated against its source. You
              choose who to contact. After you approve, Wayfinder emails, calls,
              or applies through the web form (or a combination) and keeps
              following up until there is an appointment, a screening, a
              membership, or an application, with you approving each step.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="why-heading"
        className="page-container py-section"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-stack lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:col-span-5">
            <p className={KICKER}>
              <span
                aria-hidden
                className="size-1.5 rounded-pill bg-terracotta"
              />
              Why we built it
            </p>
            <h2
              id="why-heading"
              className="m-0 mt-4 font-display text-h1 font-light text-balance text-ink display-soft"
            >
              When a disease is rare, the hardest part is finding someone who
              has <em className="emph">seen</em> it before.
            </h2>
          </div>
          <div className="grid min-w-0 content-start gap-5 lg:col-span-6 lg:col-start-7">
            <p className="m-0 text-lead text-pretty text-ink">
              A name on a list is not an appointment. Specialists, trials,
              foundations, and travel help live in different places, written for
              different readers, and every new office asks you to start from
              zero.
            </p>
            <p className="m-0 text-body text-pretty text-ink-2">
              Wayfinder does the searching and the chasing, and leaves every
              decision with you.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="journey-heading"
        className="border-y border-line bg-paper-2"
      >
        <div className="page-container grid grid-cols-[minmax(0,1fr)] gap-stack py-section lg:grid-cols-12 lg:gap-x-12">
          <div className="min-w-0 lg:col-span-4">
            <div className="lg:sticky lg:top-28">
              <p className={KICKER}>
                <span
                  aria-hidden
                  className="size-1.5 rounded-pill bg-terracotta"
                />
                The path
              </p>
              <h2
                id="journey-heading"
                className="m-0 mt-4 font-display text-h1 font-light text-balance text-ink display-soft"
              >
                From your case to a <em className="emph">connection</em>.
              </h2>
              <p className="m-0 mt-5 max-w-[26rem] text-body text-pretty text-ink-2">
                Seven steps. You are in the loop at each one that matters.
              </p>
            </div>
          </div>
          <ol
            aria-label="The path from case to appointment"
            className="m-0 min-w-0 list-none p-0 lg:col-span-8"
          >
            {STEPS.map((step, i) => (
              <li
                key={step.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 border-t border-line-strong py-6 last:border-b sm:gap-x-8"
              >
                <span
                  aria-hidden
                  className="w-10 font-display text-h2 font-light leading-none text-ink-3 display-soft sm:w-12"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="grid min-w-0 gap-1.5">
                  <h3 className="m-0 font-sans text-h4 font-bold text-ink">
                    {step.label}
                  </h3>
                  <p className="m-0 max-w-[36rem] text-body text-pretty text-ink-2">
                    {step.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        aria-labelledby="promises-heading"
        className="page-container py-section"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-stack">
          <div className="min-w-0">
            <p className={KICKER}>
              <span
                aria-hidden
                className="size-1.5 rounded-pill bg-terracotta"
              />
              Our promises
            </p>
            <h2
              id="promises-heading"
              className="m-0 mt-4 max-w-[20ch] font-display text-h1 font-light text-balance text-ink display-soft"
            >
              What you can <em className="emph">count</em> on
            </h2>
          </div>
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-4 p-0 md:grid-cols-2 lg:grid-cols-6">
            {PROMISES.map((item, i) => (
              <li
                key={item.id}
                className={`grid min-w-0 content-start gap-3 rounded-lg border border-line bg-card p-6 ${
                  i === 0 ? "lg:col-span-4" : "lg:col-span-2"
                }`}
              >
                <h3 className="m-0 font-sans text-h4 font-bold text-ink">
                  {item.title}
                </h3>
                <p className="m-0 max-w-[40rem] text-body text-pretty text-ink-2">
                  {item.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        aria-labelledby="try-heading"
        className="page-container pb-section"
      >
        <div className="grain relative overflow-hidden rounded-lg border border-line bg-card px-6 py-14 shadow-xl sm:px-12 lg:px-20 lg:py-20">
          <div className="relative max-w-[40rem]">
            <h2
              id="try-heading"
              className="m-0 font-display text-h1 font-light text-balance text-ink display-soft"
            >
              See it work on a <em className="emph">demo</em> case.
            </h2>
            <p className="m-0 mt-5 text-body text-pretty text-ink-2">
              The walkthrough uses a synthetic epithelioid sarcoma report. It is
              not a real patient.
            </p>
            <div className="mt-8">
              <Button asChild size="lg" className="group/cta">
                <Link href="/start">
                  Try the demo case
                  <ArrowRight
                    aria-hidden
                    className="transition-transform duration-300 ease-out-expo group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
                  />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
