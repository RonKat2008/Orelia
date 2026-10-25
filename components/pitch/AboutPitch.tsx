import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { PATIENT_STEP_COUNT } from "@/components/landing/content";
import { RareFacts } from "./RareFacts";

const LINK =
  "inline-flex min-h-11 items-center rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring";

/** /about: why we built it, in a few short paragraphs. Steps and promises live on their own pages. */
export function AboutPitch() {
  return (
    <>
      <div className="page-container pt-8 sm:pt-10">
        <PageHeader
          title="Why we built Orelia"
          className="mb-5"
          lede="When a disease is rare, the hardest part is finding the few specialists who have seen it before."
          action={
            <Button asChild size="lg" className="group/cta">
              <Link href="/start">
                Try the demo case
                <ArrowRight
                  aria-hidden
                  className="transition-transform duration-300 ease-out-expo group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </Button>
          }
        />
      </div>

      <div className="page-container grid gap-8 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
        <section aria-labelledby="about-body-heading">
          <h2 id="about-body-heading" className="sr-only">
            What Orelia does
          </h2>
          <div className="grid max-w-prose gap-3 text-body text-pretty text-ink-2">
            <p className="m-0">
              Most doctors may never have seen a case. A name on a list is not
              an appointment. Specialists, studies, patient groups and travel
              help live in different places. Every new office asks you to start
              from zero.
            </p>
            <p className="m-0">
              Orelia does the searching and the chasing. We look in public
              sources and check every claim. You choose who to contact, and you
              approve every message. Then we reach out and follow up, until
              there is an appointment, a screening or an answer. No diagnosis
              yet? We can help you look for one too.
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

        <RareFacts />
      </div>
    </>
  );
}
