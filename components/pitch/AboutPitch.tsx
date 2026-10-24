import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { PATIENT_STEP_COUNT } from "@/components/landing/content";

const LINK =
  "inline-flex min-h-11 items-center rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring";

/** /about: why we built it, in a few short paragraphs. Steps and promises live on their own pages. */
export function AboutPitch() {
  return (
    <>
      <div className="page-container pt-14 sm:pt-20">
        <PageHeader
          title="Why we built Wayfinder"
          lede="When a disease is rare, the hardest part is finding someone who has seen it before."
        />
      </div>

      <section
        aria-labelledby="about-body-heading"
        className="page-container pb-section"
      >
        <h2 id="about-body-heading" className="sr-only">
          What Wayfinder does
        </h2>
        <div className="grid max-w-prose gap-5 text-body text-pretty text-ink-2">
          <p className="m-0">
            A name on a list is not an appointment. Specialists, studies,
            patient groups and travel help live in different places. Every new
            office asks you to start from zero.
          </p>
          <p className="m-0">
            Wayfinder does the searching and the chasing. We look in public
            sources and check every claim. You choose who to contact, and you
            approve every message. Then we reach out and follow up, until there
            is an appointment, a screening or an answer.
          </p>
          <p className="m-0 text-small">
            <Link href="/how-it-works" className={LINK}>
              See the {PATIENT_STEP_COUNT} steps
            </Link>
            <span aria-hidden className="mx-3">
              ·
            </span>
            <Link href="/trust" className={LINK}>
              What we never do
            </Link>
          </p>
        </div>
      </section>

      <section
        aria-labelledby="try-heading"
        className="border-t border-line bg-paper-2"
      >
        <div className="page-container py-section">
          <div className="grid max-w-3xl gap-4">
            <h2
              id="try-heading"
              className="m-0 font-display text-h2 font-light text-balance text-ink display-soft"
            >
              See it work on a demo case
            </h2>
            <p className="m-0 text-body text-pretty text-ink-2">
              The walkthrough uses a made-up report. It is not a real patient.
            </p>
            <div className="mt-2">
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
