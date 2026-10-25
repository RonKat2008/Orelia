"use client";

import { useId } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger, Switch } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { GROUPS, type KindFilter, type ShortlistFilters } from "./view-model";

/**
 * One segmented control (All / Specialists / Trials / Advocacy / Aid) plus a "More filters" popover
 * (docs/DESIGN-v2.md 7.6). Buttons with aria-pressed, not tabs: there are no tab panels to control.
 */
export function FilterBar({
  filters,
  counts,
  canFilterState,
  onChange,
}: {
  filters: ShortlistFilters;
  counts: Record<string, number>;
  canFilterState: boolean;
  onChange: (next: ShortlistFilters) => void;
}) {
  const baseId = useId();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const extra = Number(filters.inState) + Number(filters.travel);
  const options: { id: KindFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: total },
    ...GROUPS.map((group) => ({ id: group.id, label: group.short, count: counts[group.id] ?? 0 })),
  ];

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div role="group" aria-label="Kind of help" className="flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-pill bg-paper-2 p-1 [scrollbar-width:none] sm:flex-wrap">
        {options.map((option) => {
          const active = filters.kind === option.id;
          const empty = option.id !== "all" && option.count === 0;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              disabled={empty}
              onClick={() => onChange({ ...filters, kind: option.id })}
              className={cn(
                "inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-pill border-0 px-3 text-small font-semibold",
                "transition-colors duration-150 focus-ring motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
                active ? "bg-card text-teal-ink shadow-xs dark:text-teal" : "bg-transparent text-ink-2 hover:text-ink",
              )}
            >
              {option.label}
              <span className="font-normal tabular-nums text-ink-2">{option.count}</span>
            </button>
          );
        })}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="link" size="sm">
            <SlidersHorizontal aria-hidden />
            More filters{extra > 0 ? ` (${extra})` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="grid w-72 gap-4">
          <div className="flex min-h-11 items-center gap-3">
            <Switch
              id={`${baseId}-state`}
              checked={filters.inState}
              disabled={!canFilterState}
              onCheckedChange={(inState) => onChange({ ...filters, inState })}
            />
            <label htmlFor={`${baseId}-state`} className="text-body text-ink">
              In my state
              {!canFilterState ? (
                <span className="block text-small text-ink-2">Add your state in intake to use this.</span>
              ) : null}
            </label>
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Switch id={`${baseId}-travel`} checked={filters.travel} onCheckedChange={(travel) => onChange({ ...filters, travel })} />
            <label htmlFor={`${baseId}-travel`} className="text-body text-ink">
              Travel help only
            </label>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
