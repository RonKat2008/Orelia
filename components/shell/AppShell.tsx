import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { SiteHeader, type NavItem } from "./SiteHeader";

/** Content column widths (docs/DESIGN-v2.md 5.1). */
const WIDTH = {
  patient: "max-w-patient",
  wide: "max-w-wide",
  judge: "max-w-judge",
  page: "",
} as const;

export type AppShellMode = "default" | "patient" | "judge";

export interface AppShellProps {
  /**
   * "default": the classic frame (title block, optional rail) for account and other non-case pages.
   * "patient": one column, no rail, body text at 18 px ([data-view="patient"]).
   * "judge": the stage bar above a wide console.
   */
  mode?: AppShellMode;
  /** Small line above the title, e.g. the condition or case id (default mode). */
  eyebrow?: ReactNode;
  /** Page title (default mode). One line, no `emph`. */
  title?: ReactNode;
  /** Supporting sentence under the title (default mode). */
  lede?: ReactNode;
  /** Right side of the title row (default mode). */
  actions?: ReactNode;
  /** Deprecated left rail (default mode only). Case pages use `top` (StageBar or PatientProgress) instead. */
  sidebar?: ReactNode;
  /** Navigation items for the default header. */
  nav?: NavItem[];
  /** Replaces the default SiteHeader (case pages pass a header with the case menu). */
  header?: ReactNode;
  /** Chrome between the header and the content: the StageBar (judge) or back link + PatientProgress (patient). */
  top?: ReactNode;
  /** Content width. Defaults: patient → "patient", judge → "judge", default → "page". */
  width?: keyof typeof WIDTH;
  /** Small trailing area inside <main>, e.g. "Manage case". */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Show the Patient / Judge switch in the default header. */
  viewToggle?: boolean;
}

function TitleBlock({ eyebrow, title, lede, actions }: Pick<AppShellProps, "eyebrow" | "title" | "lede" | "actions">) {
  if (!title && !eyebrow && !actions) return null;
  return (
    <div className="mb-10 flex flex-col gap-6 border-b border-line pb-8 md:flex-row md:items-end md:justify-between">
      <div className="grid max-w-3xl gap-3">
        {eyebrow ? <p className="m-0 text-small font-semibold text-ink-2">{eyebrow}</p> : null}
        {title ? (
          <h1 className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance">{title}</h1>
        ) : null}
        {lede ? <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

/**
 * AppShell: the frame for app pages. Sticky header, then either the classic title block (default mode) or the case
 * chrome (`top`) and a single content column, and the only <main id="main">.
 */
export function AppShell({
  mode = "default",
  eyebrow,
  title,
  lede,
  actions,
  sidebar,
  nav,
  header,
  top,
  width,
  footer,
  children,
  className,
  viewToggle = false,
}: AppShellProps) {
  const column = WIDTH[width ?? (mode === "patient" ? "patient" : mode === "judge" ? "judge" : "page")];
  const isCase = mode !== "default";

  return (
    <div
      data-slot="app-shell"
      data-view={isCase ? mode : undefined}
      className={cn("ds-root min-h-dvh bg-paper text-ink", className)}
    >
      {header ?? <SiteHeader nav={nav} cta={null} viewToggle={viewToggle} />}
      {isCase ? (
        <div className={cn("page-container", mode === "patient" ? "pb-8 sm:pb-12" : "pb-8")}>
          {/* The chrome sits inside <main> so every piece of content is in a landmark (axe "region"). */}
          <main id="main" className={cn("min-w-0", column, top ? null : mode === "patient" ? "pt-4 sm:pt-8" : "pt-6 sm:pt-10")}>
            {top ? <div className={cn(mode === "judge" ? "mb-4" : "mb-5 pt-4 sm:mb-8 sm:pt-8")}>{top}</div> : null}
            {children}
            {footer}
          </main>
        </div>
      ) : (
        <div className="page-container pb-section pt-10 sm:pt-14">
          <TitleBlock eyebrow={eyebrow} title={title} lede={lede} actions={actions} />
          <div className={cn(sidebar && "grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14")}>
            {sidebar ? (
              <aside className="lg:sticky lg:top-28 lg:self-start" aria-label="Case progress">
                {sidebar}
              </aside>
            ) : null}
            <main id="main" className={cn("min-w-0", column)}>
              {children}
              {footer}
            </main>
          </div>
        </div>
      )}
    </div>
  );
}
