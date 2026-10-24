import { DeleteCaseStub } from "@/components/journey/DeleteCaseStub";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { PROMISES } from "@/components/landing/content";
import { Details, PageHeader } from "@/components/ui";

export const metadata = {
  title: "Trust",
  description:
    "What Wayfinder will never do, and how to ask for a case to be deleted.",
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
        <div className="page-container pt-14 sm:pt-20">
          <PageHeader
            title="What Wayfinder will never do"
            lede="These limits are part of the product. They are not settings, and you cannot switch them off."
          />
        </div>

        <section
          aria-labelledby="promises-heading"
          className="page-container pb-section"
        >
          <h2 id="promises-heading" className="sr-only">
            Our five promises
          </h2>
          <ol className="m-0 list-none border-t border-line p-0">
            {PROMISES.map((promise, i) => (
              <li
                key={promise.id}
                id={ANCHORS[promise.id]}
                className="grid scroll-mt-28 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 border-b border-line py-8 md:grid-cols-[4rem_minmax(0,1fr)]"
              >
                <span
                  aria-hidden
                  className="font-display text-h3 font-light text-ink-2 display-soft"
                >
                  {i + 1}
                </span>
                <div className="grid max-w-prose gap-3">
                  <h3 className="m-0 font-display text-h3 font-light text-ink display-soft">
                    {promise.title}
                  </h3>
                  <p className="m-0 text-body text-ink-2">{promise.body}</p>
                  <Details summary="how this works">
                    <p className="m-0 text-body text-ink-2">{promise.more}</p>
                  </Details>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="delete-heading"
          className="border-t border-line"
        >
          <div className="page-container py-12">
            <div className="grid max-w-3xl gap-3">
              <h2
                id="delete-heading"
                className="m-0 font-display text-h3 font-light text-ink display-soft"
              >
                Delete a case
              </h2>
              <p className="m-0 text-body text-ink-2">
                You can ask for a case to be removed. This demo does not delete
                stored cases yet.
              </p>
              <DeleteCaseStub />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
