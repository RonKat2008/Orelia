import { Children, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/ui/cn";

/**
 * List + ListRow: the v2 way to show comparable items (shortlist, outbox, tracker, sources, documents).
 * No box per item: a hairline between rows, 16 px vertical padding, hover on paper-2, and the whole row is the
 * target (a stretched link, button or label, so a leading checkbox and trailing controls stay separately clickable).
 * See docs/DESIGN-v2.md 4.4, 4.5 and P4.
 */

export interface ListProps extends ComponentProps<"ul"> {
  /** Accessible name when the list is not introduced by a visible heading. */
  label?: string;
}

export function List({ label, className, ...props }: ListProps) {
  return <ul data-slot="list" aria-label={label} className={cn("m-0 list-none border-t border-line p-0", className)} {...props} />;
}

type RowTitleTag = "span" | "h2" | "h3" | "h4";

export interface ListRowProps extends Omit<ComponentProps<"li">, "title" | "onSelect"> {
  /** The item name. Becomes the whole-row target when `href`, `onSelect` or `selectId` is set. */
  title: ReactNode;
  /** One secondary line: type · place · how we'd reach them. */
  meta?: ReactNode;
  /**
   * Dynamic status only ("Your turn", "Replied"). Budget: 1 shown in patient view (enforced by CSS under
   * [data-view="patient"]), at most `maxBadges` (default 2) in judge view.
   */
  badges?: ReactNode;
  maxBadges?: 1 | 2;
  /** Leading 16-20 px icon, an 8 px dot, or a Checkbox (pass its id as `selectId`). */
  leading?: ReactNode;
  /** Trailing control or value (e.g. a date). Stays clickable above the row target. */
  trailing?: ReactNode;
  /** Navigate on row click. */
  href?: string;
  /** Act on row click (e.g. open the detail pane). Rendered as a button. */
  onSelect?: () => void;
  /** Id of the leading checkbox: the row becomes its label, so clicking the row toggles it. */
  selectId?: string;
  /** Selected/current row (judge list-detail). */
  selected?: boolean;
  /** Trailing chevron. Defaults to true when the row navigates or opens something. */
  chevron?: boolean;
  /** Heading level for the title when rows sit under a section heading. Default span. */
  titleAs?: RowTitleTag;
  /** Extra content under the meta line (e.g. one <Details>). Sits above the row target, so it stays operable. */
  children?: ReactNode;
}

const TARGET =
  "rounded-sm text-left text-inherit no-underline outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] " +
  "focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring cursor-pointer";

function RowTarget({ title, href, onSelect, selectId, selected }: Pick<ListRowProps, "title" | "href" | "onSelect" | "selectId" | "selected">) {
  if (href) {
    return (
      <Link href={href} data-slot="list-row-target" aria-current={selected ? "true" : undefined} className={TARGET}>
        {title}
      </Link>
    );
  }
  if (onSelect) {
    return (
      <button
        type="button"
        data-slot="list-row-target"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(TARGET, "m-0 border-0 bg-transparent p-0 font-inherit")}
      >
        {title}
      </button>
    );
  }
  if (selectId) {
    return (
      <label htmlFor={selectId} data-slot="list-row-target" className={TARGET}>
        {title}
      </label>
    );
  }
  return <>{title}</>;
}

export function ListRow({
  title,
  meta,
  badges,
  maxBadges = 2,
  leading,
  trailing,
  href,
  onSelect,
  selectId,
  selected = false,
  chevron,
  titleAs: TitleTag = "span",
  children,
  className,
  ...props
}: ListRowProps) {
  const interactive = Boolean(href || onSelect || selectId);
  const showChevron = chevron ?? Boolean(href || onSelect);
  const shownBadges = Children.toArray(badges).slice(0, maxBadges);

  return (
    <li
      data-slot="list-row"
      data-selected={selected || undefined}
      className={cn(
        "relative flex min-h-14 items-start gap-3 border-b border-line px-3 py-4 in-data-[view=judge]:min-h-12 in-data-[view=judge]:py-2.5",
        "transition-colors duration-150 motion-reduce:transition-none",
        interactive && "hover:bg-paper-2",
        selected && "bg-teal-soft hover:bg-teal-soft",
        className,
      )}
      {...props}
    >
      {leading ? <div className="relative z-10 flex min-h-6 shrink-0 items-center [&_svg]:size-5">{leading}</div> : null}
      <div className="grid min-w-0 flex-1 gap-2 in-data-[view=judge]:gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
          <TitleTag className="m-0 min-w-0 text-body font-semibold leading-snug text-ink">
            <RowTarget title={title} href={href} onSelect={onSelect} selectId={selectId} selected={selected} />
          </TitleTag>
          {shownBadges.length > 0 ? (
            <span data-slot="list-row-badges" className="flex shrink-0 flex-wrap items-center gap-3">
              {shownBadges}
            </span>
          ) : null}
        </div>
        {meta ? <p className="m-0 text-small text-ink-2">{meta}</p> : null}
        {children ? <div className="relative z-10">{children}</div> : null}
      </div>
      {trailing ? <div className="relative z-10 flex shrink-0 items-center self-center text-small text-ink-2">{trailing}</div> : null}
      {showChevron ? <ChevronRight aria-hidden className="size-5 shrink-0 self-center text-ink-3" /> : null}
    </li>
  );
}
