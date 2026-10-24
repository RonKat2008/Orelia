import type { ReactNode } from "react";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { cn } from "@/lib/ui/cn";

/** Frame for informational pages: header, main landmark, footer. */
export function EditorialPage({ children }: { children: ReactNode }) {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Opening band: eyebrow, big serif headline, lede. */
export function EditorialHero({
  eyebrow,
  title,
  lede,
  children,
  compact = false,
}: {
  compact?: boolean;
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="grain border-b border-line bg-paper-2/70">
      <div className="page-container grid gap-6 py-16 sm:py-24">
        <p className="m-0 text-micro font-semibold uppercase text-ink-3">
          <span aria-hidden className="mr-2 inline-block h-px w-8 translate-y-[-3px] bg-terracotta align-middle" />
          {eyebrow}
        </p>
        <h1
          className={cn(
            "m-0 font-display font-light text-ink display-soft text-balance",
            compact ? "max-w-[22ch] text-h1" : "max-w-[18ch] text-display",
          )}
        >
          {title}
        </h1>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">{lede}</p>
        {children ? <div className="flex flex-wrap gap-3 pt-2">{children}</div> : null}
      </div>
    </header>
  );
}

/** A long-form section: numbered marker, serif h2, readable prose column. */
export function EditorialSection({
  id,
  number,
  title,
  children,
  className,
}: {
  id: string;
  number?: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn("scroll-mt-28 border-t border-line pt-8", className)}>
      {number ? <p className="m-0 mb-3 font-mono text-mono text-ink-3">{number}</p> : null}
      <h2
        id={`${id}-heading`}
        className="m-0 mb-4 max-w-none font-display text-h2 font-light text-ink display-soft text-balance"
      >
        {title}
      </h2>
      <div className="grid max-w-prose gap-4 text-body text-ink-2 text-pretty [&_p]:m-0 [&_strong]:text-ink">{children}</div>
    </section>
  );
}
