"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { Sheet } from "./sheet";
import { useMediaQuery } from "./use-media-query";

/** The judge console splits into two panes from 1024 px up (docs/DESIGN-v2.md 5.3). */
export const WIDE_QUERY = "(min-width: 1024px)";

export interface TwoPaneProps {
  /** The list pane: usually a <List> of <ListRow onSelect selected>. Scrolls on its own from 1024 px. */
  list: ReactNode;
  /** Detail for the selected row. Null/undefined shows `emptyDetail`. */
  detail?: ReactNode;
  /** Shown in the detail pane when nothing is selected (desktop only). */
  emptyDetail?: ReactNode;
  /** Below 1024 px the detail opens in a Sheet (bottom drawer on phones). Controlled by the page. */
  detailOpen?: boolean;
  onDetailOpenChange?: (open: boolean) => void;
  /** Sheet heading below 1024 px: usually the selected item's name. */
  detailTitle?: ReactNode;
  /** Optional sticky footer inside the Sheet (the item's primary action). */
  detailFooter?: ReactNode;
  /** Accessible names for the two panes. */
  listLabel?: string;
  detailLabel?: string;
  /** Optional toolbar above the list (filters as one segmented control). */
  listHeader?: ReactNode;
  className?: string;
}

const ROW_TARGET = '[data-slot="list-row-target"]';

/** j / k move focus between rows (Enter then opens the row natively). Ignored while typing. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "j" && event.key !== "k") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
  const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_TARGET));
  if (targets.length === 0) return;
  const index = active ? targets.indexOf(active) : -1;
  const next = event.key === "j" ? Math.min(targets.length - 1, index + 1) : Math.max(0, index - 1);
  event.preventDefault();
  targets[next]?.focus();
}

/**
 * TwoPane: the judge list/detail console. From 1024 px the list (26rem) sits left and scrolls inside its pane, and
 * the detail pane on the right is sticky. Below 1024 px only the list shows, and the selected row's detail opens in
 * a Sheet. The server renders the wide layout (no layout shift on desktop; on phones the hidden pane is dropped
 * right after hydration).
 */
export function TwoPane({
  list,
  detail,
  emptyDetail,
  detailOpen = false,
  onDetailOpenChange,
  detailTitle,
  detailFooter,
  listLabel = "Items",
  detailLabel = "Details",
  listHeader,
  className,
}: TwoPaneProps) {
  const wide = useMediaQuery(WIDE_QUERY, true);
  const hasDetail = detail !== null && detail !== undefined;

  return (
    <div data-slot="two-pane" className={cn("grid gap-6 lg:grid-cols-[26rem_minmax(0,1fr)] lg:items-start", className)}>
      <section
        aria-label={listLabel}
        onKeyDown={moveFocus}
        className="grid min-w-0 gap-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
      >
        {listHeader}
        {list}
      </section>
      {wide ? (
        <section
          aria-label={detailLabel}
          className="hidden min-w-0 rounded-lg border border-line bg-card p-6 lg:sticky lg:top-24 lg:block"
        >
          {hasDetail ? detail : emptyDetail}
        </section>
      ) : (
        <Sheet
          open={detailOpen && hasDetail}
          onOpenChange={onDetailOpenChange}
          title={detailTitle ?? detailLabel}
          footer={detailFooter}
        >
          {detail}
        </Sheet>
      )}
    </div>
  );
}
