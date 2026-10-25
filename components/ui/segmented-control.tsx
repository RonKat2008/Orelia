"use client";

import type { ReactNode } from "react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/ui/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional count shown after the label ("All 16"). */
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group ("Filter the shortlist"). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/**
 * SegmentedControl: one row of mutually exclusive filters (judge list filters, docs/DESIGN-v2.md 7.6). Use it
 * instead of Tabs when there are no tab panels (Tabs without panels leave aria-controls pointing nowhere).
 * Arrow keys move between options; the selected one is teal-soft, never an ink fill.
 */
export function SegmentedControl<T extends string>({ label, options, value, onValueChange, className }: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        // Radix allows deselecting the active item; a filter always has one value.
        if (next) onValueChange(next as T);
      }}
      data-slot="segmented-control"
      className={cn("inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-pill bg-paper-2 p-1 shadow-inset [scrollbar-width:none] sm:flex-wrap", className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          data-slot="segmented-option"
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-pill px-4 text-small font-semibold text-ink-2",
            "transition-[background-color,color] duration-150 hover:text-ink focus-ring motion-reduce:transition-none",
            "data-[state=on]:bg-teal-soft data-[state=on]:text-teal-ink dark:data-[state=on]:text-teal",
          )}
        >
          {option.label}
          {typeof option.count === "number" ? <span className="tabular-nums font-normal">{option.count}</span> : null}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
