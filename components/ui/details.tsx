"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/ui/cn";

/** True inside a Details panel: v2 allows one level of disclosure only (R6, P3). */
const NestedContext = createContext(false);

export interface DetailsProps {
  /** What is behind it: renders "Details: <summary>". */
  summary: ReactNode;
  /** Prefix before the summary. Default "Details". Pass null for a bare summary ("Why this one?"). */
  label?: ReactNode | null;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the content only once first opened (default true): heavy evidence stays out of the first paint. */
  lazy?: boolean;
  className?: string;
}

/**
 * Details: the one labelled disclosure for information some users need (docs/DESIGN-v2.md P3, R29). A button with
 * aria-expanded (Enter and Space work) and a region that opens with a 250 ms grid-rows transition (instant under
 * reduced motion). Closed content is inert, so it is skipped by Tab and screen readers. Never nest one in another;
 * in development a nested Details logs a warning.
 */
export function Details({
  summary,
  label = "Details",
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  lazy = true,
  className,
}: DetailsProps) {
  const nested = useContext(NestedContext);
  if (nested && process.env.NODE_ENV !== "production") {
    console.warn("Details: do not nest disclosures (docs/DESIGN-v2.md P3). Use a ListRow or plain text inside.");
  }
  const [openState, setOpenState] = useState(defaultOpen);
  const [hasOpened, setHasOpened] = useState(defaultOpen);
  const open = openProp ?? openState;
  const id = useId();
  const panelId = `${id}-panel`;

  const toggle = () => {
    const next = !open;
    if (next) setHasOpened(true);
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const renderContent = !lazy || open || hasOpened;

  return (
    <div data-slot="details" data-state={open ? "open" : "closed"} className={cn("grid", className)}>
      <button
        type="button"
        data-slot="details-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={cn(
          "group/details inline-flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0",
          "text-left text-body font-semibold text-teal hover:text-teal-ink focus-ring",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform duration-200 ease-out-expo motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="underline decoration-teal/35 underline-offset-[0.22em] group-hover/details:decoration-teal-ink">
          {label ? (
            <>
              {label}: {summary}
            </>
          ) : (
            summary
          )}
        </span>
      </button>
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] ease-out-expo motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100 duration-250" : "grid-rows-[0fr] opacity-0 duration-200",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-3 pb-2 pl-5.5 pt-2 text-body text-ink-2">
            <NestedContext.Provider value>{renderContent ? children : null}</NestedContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}
