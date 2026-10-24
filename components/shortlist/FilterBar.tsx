"use client";

import { useId } from "react";
import { Switch, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { GROUPS, type KindFilter, type ShortlistFilters } from "./view-model";

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
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border border-line bg-card/70 p-4 shadow-xs sm:p-5"
      role="group"
      aria-label="Filter the shortlist"
    >
      <Tabs
        className="min-w-0"
        value={filters.kind}
        onValueChange={(kind) =>
          onChange({ ...filters, kind: kind as KindFilter })
        }
      >
        <TabsList variant="pill" aria-label="Kind of help">
          <TabsTrigger value="all">All ({total})</TabsTrigger>
          {GROUPS.map((group) => (
            <TabsTrigger
              key={group.id}
              value={group.id}
              disabled={(counts[group.id] ?? 0) === 0}
            >
              {group.short} ({counts[group.id] ?? 0})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
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
              <span className="block text-small text-ink-3">
                Add your state in intake to use this.
              </span>
            ) : null}
          </label>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id={`${baseId}-travel`}
            checked={filters.travel}
            onCheckedChange={(travel) => onChange({ ...filters, travel })}
          />
          <label htmlFor={`${baseId}-travel`} className="text-body text-ink">
            Travel help only
          </label>
        </div>
      </div>
    </div>
  );
}
