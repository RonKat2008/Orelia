"use client";

import { Eye, HeartHandshake } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import { hrefForView, type ViewMode } from "@/lib/view-mode/view-mode";
import { useSetViewMode, useViewMode } from "./view-store";

const OPTIONS: { value: ViewMode; label: string; hint: string; Icon: typeof Eye }[] = [
  { value: "patient", label: "Patient", hint: "Simple steps and one thing to do at a time", Icon: HeartHandshake },
  { value: "judge", label: "Judge", hint: "Every agent, source and score in full detail", Icon: Eye },
];

/** Segmented "Patient view / Judge view" switch. Same case, same data; only the level of detail changes. */
export function ViewToggle({ className }: { className?: string }) {
  const view = useViewMode();
  const setView = useSetViewMode();
  const pathname = usePathname() ?? "/";
  return (
    <div
      role="radiogroup"
      aria-label="View"
      data-slot="view-toggle"
      data-view={view}
      className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-pill border border-line bg-paper-2 p-0.5 shadow-inset", className)}
    >
      {OPTIONS.map(({ value, label, hint, Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            data-slot="view-option"
            data-value={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            onClick={() => {
              // Re-clicking "Patient" on a detailed case page still takes you to the simple case home.
              if (!active || hrefForView(pathname, value).split("?")[0] !== pathname) setView(value);
            }}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-pill px-2.5 text-small font-semibold text-ink-2 sm:px-3",
              "transition-[background-color,color,box-shadow] duration-150 hover:text-ink focus-ring motion-reduce:transition-none",
              active && "bg-card text-ink shadow-sm",
            )}
          >
            <Icon aria-hidden className={cn("size-4", active ? "text-teal" : "text-ink-3")} />
            {/* Icon-only below 360 px so the header never overflows at 320 px; the words stay for screen readers. */}
            <span className="max-[22.5rem]:sr-only">
              {label}
              <span className="sr-only sm:not-sr-only lg:sr-only"> view</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
