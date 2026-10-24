"use client";

import { LayoutGrid, List, Search } from "lucide-react";
import { LIBRARY_DOC_TYPES, LIBRARY_DOC_TYPE_LABELS } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/ui/cn";
import { hasActiveFilters, EMPTY_FILTERS, type DocumentFilters } from "../helpers/filter";
import type { LibraryView } from "./DocumentCard";

const VIEW_BUTTON =
  "grid size-9 cursor-pointer place-items-center rounded-sm text-ink-2 transition-colors duration-150 hover:text-ink focus-ring " +
  "aria-pressed:bg-card aria-pressed:text-teal aria-pressed:shadow-xs [&_svg]:size-4";

export function LibraryToolbar({
  filters,
  onFilters,
  view,
  onView,
  shown,
  total,
}: {
  filters: DocumentFilters;
  onFilters: (next: DocumentFilters) => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  shown: number;
  total: number;
}) {
  const set = (change: Partial<DocumentFilters>) => onFilters({ ...filters, ...change });
  return (
    <div role="search" aria-label="Search your documents" className="grid gap-4 rounded-lg border border-line bg-card p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="lib-search" className="min-w-0 flex-[2_1_14rem]">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              id="lib-search"
              type="search"
              value={filters.query}
              onChange={(event) => set({ query: event.target.value })}
              placeholder="Title, provider, tag or note"
              className="pl-10"
            />
          </div>
        </Field>
        <Field label="Type" htmlFor="lib-type" className="min-w-0 flex-[1_1_10rem]">
          <Select value={filters.docType} onValueChange={(docType) => set({ docType: docType as DocumentFilters["docType"] })}>
            <SelectTrigger id="lib-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {LIBRARY_DOC_TYPES.map((type) => <SelectItem key={type} value={type}>{LIBRARY_DOC_TYPE_LABELS[type]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="From" htmlFor="lib-from" className="min-w-0 flex-[1_1_9rem]">
          <Input id="lib-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set({ from: event.target.value })} />
        </Field>
        <Field label="To" htmlFor="lib-to" className="min-w-0 flex-[1_1_9rem]">
          <Input id="lib-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set({ to: event.target.value })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-small text-ink-2" aria-live="polite">
          Showing {shown} of {total} {total === 1 ? "document" : "documents"}
          {hasActiveFilters(filters) ? (
            <Button variant="link" size="sm" className="ml-3" onClick={() => onFilters(EMPTY_FILTERS)}>Clear filters</Button>
          ) : null}
        </p>
        <div role="group" aria-label="Layout" className={cn("inline-flex gap-1 rounded-md bg-paper-2 p-1 shadow-inset")}>
          <button type="button" className={VIEW_BUTTON} aria-pressed={view === "grid"} onClick={() => onView("grid")} aria-label="Grid view">
            <LayoutGrid aria-hidden />
          </button>
          <button type="button" className={VIEW_BUTTON} aria-pressed={view === "list"} onClick={() => onView("list")} aria-label="List view">
            <List aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
