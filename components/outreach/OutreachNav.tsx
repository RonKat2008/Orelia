import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";

const links = [
  { slug: "consent", label: "Consent" },
  { slug: "plan", label: "Plan" },
  { slug: "outbox", label: "Outbox" },
  { slug: "tracker", label: "Tracker" },
  { slug: "threads", label: "Threads" },
] as const;

export type OutreachSlug = (typeof links)[number]["slug"];

/**
 * Frame for the four outreach screens: an editorial heading and a small stage
 * switcher (consent, outbox, tracker, threads) above the content.
 */
export function OutreachNav({
  caseId,
  current,
  eyebrow,
  title,
  lede,
  children,
}: {
  caseId: string;
  current: OutreachSlug;
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  children: ReactNode;
}) {
  // The case layout already supplies the header, journey rail and <main>: render content only.
  return (
    <section className="ds-root grid grid-cols-[minmax(0,1fr)] gap-10" aria-labelledby="outreach-title">
      <header className="grid max-w-3xl gap-3 border-b border-line pb-8">
        <p className="m-0 text-micro font-semibold uppercase text-ink-3">{eyebrow}</p>
        <h2
          id="outreach-title"
          className="m-0 max-w-none font-display text-h2 font-light text-ink display-soft text-balance"
        >
          {title}
        </h2>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">{lede}</p>
      </header>
      <nav aria-label="Outreach">
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
          {links.map((link, index) => {
            const active = link.slug === current;
            return (
              <li key={link.slug}>
                <Link
                  href={`/cases/${caseId}/${link.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-small font-semibold no-underline focus-ring",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-line-strong bg-card text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  <span aria-hidden className={cn("tabular-nums", active ? "text-paper/70" : "text-ink-3")}>
                    {index + 1}
                  </span>
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
    </section>
  );
}
