import { DeleteCaseStub } from "@/components/journey/DeleteCaseStub";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { PROMISES } from "@/components/landing/content";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Trust",
  description:
    "What Orelia will never do for adults with a rare disease, and how to ask for a case to be deleted.",
};

/** Anchors the footer links to. */
const ANCHORS: Record<string, string> = {
  advice: "sources",
  approval: "consent",
};

export default function TrustPage() {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main">
        <div className="page-container pt-8 sm:pt-10">
          <PageHeader
            title="What Orelia will never do"
            className="mb-6"
            lede="Your health story is private. These limits are part of the product. They are not settings, and you cannot switch them off."
          />
        </div>

        <section
          aria-labelledby="promises-heading"
          className="page-container pb-10"
        >
          <h2 id="promises-heading" className="sr-only">
            Our five promises
          </h2>
          <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {PROMISES.map((promise, i) => (
              <li
                key={promise.id}
                id={ANCHORS[promise.id]}
                className="grid scroll-mt-28 content-start gap-2 rounded-lg border border-line bg-paper-2/60 p-4"
              >
                <h3 className="m-0 flex items-baseline gap-2 font-display text-h3 font-light text-ink display-soft">
                  <span aria-hidden className="text-teal">
                    {i + 1}
                  </span>
                  {promise.title}
                </h3>
                <p className="m-0 text-body text-ink">{promise.body}</p>
                <p className="m-0 text-small text-ink-2">{promise.more}</p>
              </li>
            ))}
            <li
              aria-labelledby="delete-heading"
              className="grid content-start justify-items-start gap-2 rounded-lg border border-line p-4"
            >
              <h3
                id="delete-heading"
                className="m-0 font-display text-h3 font-light text-ink display-soft"
              >
                Delete a case
              </h3>
              <p className="m-0 text-small text-ink-2">
                You can ask for a case to be removed. This demo does not delete
                stored cases yet.
              </p>
              <DeleteCaseStub />
            </li>
          </ol>
        </section>

      </main>
      <SiteFooter />
    </div>
  );
}
