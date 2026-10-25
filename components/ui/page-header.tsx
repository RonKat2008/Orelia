import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export interface PageHeaderProps extends Omit<ComponentProps<"header">, "title"> {
  /** One line: the page question or title. No `emph` (that is for the landing h1 only). */
  title: ReactNode;
  /** At most one sentence (20 words). */
  lede?: ReactNode;
  /** One action for the page header (judge view puts its primary here). */
  action?: ReactNode;
  /** Judge view only: a short eyebrow. Hidden automatically inside [data-view="patient"]. */
  eyebrow?: ReactNode;
  /** Heading level. Default h1: the case shell no longer prints a page title, so each page owns its h1. */
  as?: "h1" | "h2";
  /** Id for the heading, to label a surrounding region. */
  titleId?: string;
}

/**
 * PageHeader: title, optional one-sentence lede and optional action (docs/DESIGN-v2.md 6). Replaces PageIntro and the
 * OutreachNav header block. No border and no uppercase eyebrow in patient view.
 */
export function PageHeader({ title, lede, action, eyebrow, as: Heading = "h1", titleId, className, ...props }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn("mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between in-data-[view=judge]:gap-2 md:in-data-[view=judge]:items-center", className)}
      {...props}
    >
      <div className="grid max-w-3xl gap-3 in-data-[view=judge]:gap-1">
        {eyebrow ? (
          <p className="m-0 text-small font-semibold text-ink-2 in-data-[view=patient]:hidden in-data-[view=judge]:sr-only">{eyebrow}</p>
        ) : null}
        <Heading id={titleId} className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance in-data-[view=judge]:text-h3">
          {title}
        </Heading>
        {lede ? <p className="m-0 max-w-prose text-body text-ink-2 text-pretty in-data-[view=judge]:text-small">{lede}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div> : null}
    </header>
  );
}

export interface BackLinkProps extends Omit<ComponentProps<typeof Link>, "children"> {
  /** Default "Back". Prefer a destination: "Back to your case". */
  children?: ReactNode;
}

/** BackLink: the quiet "‹ Back" link at the top of every patient sub-page and question page (R2). */
export function BackLink({ children = "Back", className, ...props }: BackLinkProps) {
  return (
    <Link
      data-slot="back-link"
      className={cn(
        "inline-flex min-h-11 w-fit items-center gap-1 rounded-sm text-small font-semibold text-teal no-underline",
        "hover:text-teal-ink hover:underline underline-offset-4 focus-ring",
        className,
      )}
      {...props}
    >
      <ChevronLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
