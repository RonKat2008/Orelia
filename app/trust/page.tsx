import { Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SourceChip } from "@/components/ui/source-chip";
import { DeleteCaseStub } from "@/components/journey/DeleteCaseStub";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { TrustPagePromises } from "@/components/landing/info/TrustPagePromises";

export const metadata = {
  title: "Trust",
  description: "What Wayfinder will never do, and how to ask for a case to be deleted.",
};

const KICKER = "m-0 text-micro font-semibold uppercase text-ink-3";
const H3 = "m-0 font-display text-h3 font-light text-balance text-ink display-soft";

export default function TrustPage() {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main">
        <header className="grain relative">
          <div className="page-container grid grid-cols-[minmax(0,1fr)] gap-6 pb-12 pt-14 sm:pt-20">
            <p className={KICKER}>Trust</p>
            <h1 className="m-0 max-w-4xl font-display text-display font-light text-balance display-soft">
              What Wayfinder will <em className="emph">never</em> do.
            </h1>
            <p className="m-0 max-w-prose text-lead text-pretty text-ink-2">
              Wayfinder finds public intake doors and drafts contact for you to approve. The limits below are part of the
              product, not optional settings.
            </p>
          </div>
        </header>

        <section id="never" aria-labelledby="never-heading" className="page-container pb-section">
          <h2 id="never-heading" className="sr-only">
            Never
          </h2>
          <TrustPagePromises />
        </section>

        <section className="border-y border-line bg-paper-2">
          <div className="page-container grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-14 py-section lg:grid-cols-12">
            <div id="sources" className="grid min-w-0 content-start gap-4 lg:col-span-7">
              <p className={KICKER}>Sources</p>
              <h2 id="sources-heading" className={H3}>How we cite sources</h2>
              <p className="m-0 max-w-prose text-body text-ink-2">
                Every claim about a resource links to the public page it came from. A verifier drops any claim without a
                source.
              </p>
              <div className="mt-2 grid max-w-md gap-3 rounded-lg border border-line bg-card p-5 shadow-sm">
                <Badge tone="outline" className="w-fit">Example</Badge>
                <SourceChip url="clinicaltrials.gov" verified />
              </div>
            </div>

            <div id="consent" className="grid min-w-0 content-start gap-4 lg:col-span-5">
              <p className={KICKER}>Consent</p>
              <h2 id="consent-heading" className={H3}>Your approval, always</h2>
              <p className="m-0 text-body text-ink-2">
                Drafts wait for you. A message includes only the case fields you tick, and every email or call says that AI
                assistance was used.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="fields-heading" className="page-container grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-12 py-section md:grid-cols-3">
          <div className="grid min-w-0 content-start gap-3">
            <p className={KICKER}>Fields</p>
            <h2 id="fields-heading" className={H3}>Only the fields you choose</h2>
            <p className="m-0 text-body text-ink-2">
              You tick which details each contact may see. Anything unticked stays out of the email, the call and the form.
            </p>
          </div>
          <div className="grid min-w-0 content-start gap-3">
            <p className={KICKER}>Disclosure</p>
            <h2 className={H3}>AI disclosure</h2>
            <p className="m-0 text-body text-ink-2">
              Every outbound email, and the start of every call, says that AI assistance was used.
            </p>
          </div>
          <div className="grid min-w-0 content-start gap-3">
            <p className={KICKER}>Demo</p>
            <h2 className={H3}>Demo allowlist</h2>
            <p className="m-0 text-body text-ink-2">
              In demo mode, messages can only reach addresses and numbers on an approved test list. Real intake teams are
              never contacted.
            </p>
          </div>
        </section>

        <section aria-labelledby="emergency-heading" className="page-container pb-section">
          <div className="flex min-w-0 items-start gap-4 rounded-lg border border-gold/50 bg-gold-soft p-6 sm:items-center sm:p-8">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-md border border-gold/50 bg-card text-ink">
              <Phone className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h2 id="emergency-heading" className="m-0 font-sans text-h4 font-bold text-ink">Emergencies</h2>
              <p className="m-0 text-body text-ink">In an emergency call 911 or contact your care team.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="delete-heading" className="border-t border-line">
          <div className="page-container grid max-w-3xl gap-3 py-12">
            <p className={KICKER}>Your data</p>
            <h2 id="delete-heading" className="m-0 font-sans text-h4 font-bold text-ink">Delete a case</h2>
            <p className="m-0 text-body text-ink-2">
              You can ask for a case to be removed. This demo does not delete stored cases yet.
            </p>
            <DeleteCaseStub />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
