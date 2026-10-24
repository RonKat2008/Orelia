import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { SiteHeader, type NavItem } from "./SiteHeader";

export interface AppShellProps {
  /** Small line above the title, e.g. the condition or case id. */
  eyebrow?: ReactNode;
  /** Page title. Use <em className="emph"> for the one emphasised word. */
  title?: ReactNode;
  /** Supporting sentence under the title. */
  lede?: ReactNode;
  /** Right side of the title row: primary actions for this view. */
  actions?: ReactNode;
  /** Left rail on desktop (e.g. a vertical Stepper); stacks above content on mobile. */
  sidebar?: ReactNode;
  /** Case-level navigation items for the header. */
  nav?: NavItem[];
  children: ReactNode;
  className?: string;
  /** Show the Patient view / Judge view switch in the header. */
  viewToggle?: boolean;
}

/**
 * AppShell: the frame for case pages. Sticky header, an editorial title block,
 * an optional sticky rail and a readable main column.
 */
export function AppShell({ eyebrow, title, lede, actions, sidebar, nav, children, className, viewToggle = false }: AppShellProps) {
  return (
    <div data-slot="app-shell" className={cn("ds-root min-h-dvh bg-paper text-ink", className)}>
      <SiteHeader nav={nav} cta={null} viewToggle={viewToggle} />
      <div className="page-container pb-section pt-10 sm:pt-14">
        {title || eyebrow || actions ? (
          <div className="mb-10 flex flex-col gap-6 border-b border-line pb-8 md:flex-row md:items-end md:justify-between">
            <div className="grid max-w-3xl gap-3">
              {eyebrow ? <p className="m-0 text-micro font-semibold uppercase text-ink-3">{eyebrow}</p> : null}
              {title ? (
                <h1 className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance">
                  {title}
                </h1>
              ) : null}
              {lede ? <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">{lede}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
          </div>
        ) : null}
        <div className={cn(sidebar && "grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14")}>
          {sidebar ? (
            <aside className="lg:sticky lg:top-28 lg:self-start" aria-label="Case progress">
              {sidebar}
            </aside>
          ) : null}
          <main id="main" className="min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
