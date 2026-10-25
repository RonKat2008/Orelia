import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface ActionCardProps extends Omit<ComponentProps<"section">, "title"> {
  /** The question or decision, e.g. "Can we tell them your diagnosis?". Do not repeat the button's words. */
  title: ReactNode;
  /** Heading level. Default h2 (the page h1 sits above the card). */
  titleAs?: "h1" | "h2" | "h3";
  /** At most one sentence. */
  lede?: ReactNode;
  /** The view's one primary Button (patient view: size="lg"). */
  action?: ReactNode;
  /** At most one quiet alternative: a link-variant Button ("Skip for now"). */
  secondaryAction?: ReactNode;
  /** One short line under the button, e.g. "Nothing is sent without your OK." Say it once per screen. */
  reassurance?: ReactNode;
  /** The question's controls or the decision's content. */
  children?: ReactNode;
  /** Phone only: keep the action pinned to the bottom of the screen so it never sits below the fold. */
  stickyAction?: boolean;
}

/**
 * ActionCard: the single "do this now" block (docs/DESIGN-v2.md 4.4). At most one per view. A raised card with a
 * 2 px teal top edge; title, optional one-line lede, body, the primary button left-aligned, and a reassurance line.
 */
export function ActionCard({
  title,
  titleAs: TitleTag = "h2",
  lede,
  action,
  secondaryAction,
  reassurance,
  children,
  stickyAction = false,
  className,
  ...props
}: ActionCardProps) {
  const titleId = useId();
  return (
    <section
      data-slot="action-card"
      aria-labelledby={titleId}
      className={cn(
        "relative grid gap-6 rounded-lg border border-line/70 border-t-2 border-t-teal bg-card p-6 text-ink shadow-md sm:p-9",
        className,
      )}
      {...props}
    >
      <div className="grid gap-2">
        <TitleTag id={titleId} className="m-0 max-w-none font-display text-h3 font-normal text-ink display-soft text-balance">
          {title}
        </TitleTag>
        {lede ? <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">{lede}</p> : null}
      </div>
      {children ? <div className="grid gap-4">{children}</div> : null}
      {action || secondaryAction || reassurance ? (
        <div
          className={cn(
            "grid gap-3",
            stickyAction &&
              "max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:-mb-4 max-sm:rounded-b-lg max-sm:border-t max-sm:border-line max-sm:bg-card max-sm:px-4 max-sm:py-3",
          )}
        >
          {action || secondaryAction ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {action}
              {secondaryAction}
            </div>
          ) : null}
          {reassurance ? <p className="m-0 text-small text-ink-2">{reassurance}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
