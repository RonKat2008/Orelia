import { DeleteCaseStub } from "@/components/journey/DeleteCaseStub";
import { SiteFooter, SiteHeader } from "@/components/shell";

export const metadata = {
  title: "Trust",
  description: "What Wayfinder will never do, and how to ask for a case to be deleted.",
};

const NEVER = [
  "Give medical advice, interpret a prognosis, or rank care options.",
  "Contact a person or organization unless you approved that message.",
  "Scrape personal email addresses. Outreach uses public intake doors only.",
];

export default function TrustPage() {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main" className="page-container pb-section pt-10 sm:pt-14">
        <div className="mb-12 grid max-w-3xl gap-3 border-b border-line pb-10">
          <p className="m-0 text-micro font-semibold uppercase text-ink-3">Trust</p>
          <h1 className="m-0 max-w-none font-display text-h1 font-light display-soft text-balance">
            What Wayfinder will never do
          </h1>
          <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
            Wayfinder finds public intake doors and drafts contact for you to approve. The limits below are part of the
            product, not optional settings.
          </p>
        </div>

        <section id="never" aria-labelledby="never-heading" className="grid max-w-3xl gap-4">
          <h2 id="never-heading" className="m-0 font-display text-h2 font-light display-soft">
            Never
          </h2>
          <ul className="m-0 grid list-disc gap-2 rounded-lg border border-line bg-paper-2 py-5 pl-10 pr-5 text-body text-ink marker:text-teal">
            {NEVER.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section id="sources" aria-labelledby="sources-heading" className="mt-14 grid max-w-3xl gap-3">
          <h2 id="sources-heading" className="m-0 font-display text-h3">
            How we cite sources
          </h2>
          <p className="m-0 text-body text-ink-2">
            Every claim about a resource links to the public page it came from. A verifier drops any claim without a
            source.
          </p>
        </section>

        <section id="consent" aria-labelledby="consent-heading" className="mt-10 grid max-w-3xl gap-3">
          <h2 id="consent-heading" className="m-0 font-display text-h3">
            Your approval, always
          </h2>
          <p className="m-0 text-body text-ink-2">
            Drafts wait for you. A message includes only the case fields you tick, and every email or call says that AI
            assistance was used.
          </p>
        </section>

        <section aria-labelledby="delete-heading" className="mt-14 grid max-w-3xl gap-3">
          <h2 id="delete-heading" className="m-0 font-display text-h3">
            Delete a case
          </h2>
          <p className="m-0 text-body text-ink-2">
            You can ask for a case to be removed. This demo does not delete stored cases yet.
          </p>
          <DeleteCaseStub />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
