import { loadRareFacts } from "@/lib/rare-disease/facts";

export const RARE_INTRO =
  "The zebra is the symbol of rare disease. It comes from a saying: when you hear hoofbeats, think horses, not zebras.";

const SOURCE_LINK =
  "inline-flex min-h-11 items-center rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring";

function sourceHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/** /about: "For rare disease". Each number is shown with the exact sentence it came from and a link. */
export function RareFacts() {
  const facts = loadRareFacts();
  return (
    <section aria-labelledby="rare-heading" className="page-container pb-section">
      <div className="grid max-w-prose gap-5">
        <h2 id="rare-heading" className="m-0 font-display text-h2 font-light text-balance text-ink display-soft">
          For rare disease
        </h2>
        <p className="m-0 text-body text-pretty text-ink-2">{RARE_INTRO}</p>
        {facts.length > 0 ? (
          <ul className="m-0 grid list-none gap-6 p-0">
            {facts.map((fact) => (
              <li key={fact.id} className="grid gap-2">
                <p className="m-0 text-body font-semibold text-pretty text-ink">{fact.claim}</p>
                <blockquote className="m-0 border-l-2 border-line-strong pl-4 text-small text-pretty text-ink-2">
                  {fact.excerpt}
                </blockquote>
                <a href={fact.url} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
                  Source: {sourceHost(fact.url)}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
