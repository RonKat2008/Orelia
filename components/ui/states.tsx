"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/ui/cn";

/** After this long a loading view says so in words (docs/DESIGN-v2.md 6, Loading). */
export const SLOW_LOADING_MS = 3000;

export interface LoadingStateProps {
  /** Screen-reader text now, and the visible line once loading is slow: "Loading your case". */
  label?: string;
  /** Visible line after `slowAfterMs`. Default: "Still loading…" built from the label. */
  slowLabel?: string;
  slowAfterMs?: number;
  /** Skeletons shaped like the final layout (Skeleton is aria-hidden). */
  children?: ReactNode;
  className?: string;
}

/**
 * LoadingState: a busy region whose skeleton matches the final layout, and, after 3 s, one quiet status line
 * ("Still loading your case…") so a slow load never looks stuck.
 */
export function LoadingState({ label = "Loading", slowLabel, slowAfterMs = SLOW_LOADING_MS, children, className }: LoadingStateProps) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), slowAfterMs);
    return () => window.clearTimeout(timer);
  }, [slowAfterMs]);
  const slowText = slowLabel ?? `Still ${label.charAt(0).toLowerCase()}${label.slice(1)}…`;

  return (
    <div data-slot="loading-state" aria-busy="true" className={cn("grid gap-6", className)}>
      <p role="status" className={cn("m-0 text-small text-ink-2", !slow && "sr-only")}>
        {slow ? slowText : label}
      </p>
      {children}
    </div>
  );
}

export interface CheckedMarkProps {
  /** Number of sources the claim was checked against. */
  sources?: number;
  className?: string;
}

/**
 * CheckedMark: "✓ Checked · 3 sources", once per item, replacing a row of Verified chips (docs/DESIGN-v2.md 4.5).
 * Plain text in `ok`, not a badge, so it does not count against the badge budget.
 */
export function CheckedMark({ sources, className }: CheckedMarkProps) {
  return (
    <span data-slot="checked-mark" className={cn("inline-flex items-center gap-1 text-small font-semibold text-ok", className)}>
      <ShieldCheck aria-hidden className="size-4 shrink-0" />
      Checked
      {typeof sources === "number" && sources > 0 ? (
        <span className="font-normal text-ink-2">
          {" · "}
          {sources === 1 ? "1 source" : `${sources} sources`}
        </span>
      ) : null}
    </span>
  );
}
