"use client";

import { Search } from "lucide-react";
import { LIBRARY_DOC_TYPES, LIBRARY_DOC_TYPE_LABELS } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { Details } from "@/components/ui/details";
import { Field, Input } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hasActiveFilters, EMPTY_FILTERS, type DocumentFilters } from "../helpers/filter";

export function LibraryToolbar({
  filters,
  onFilters,
  shown,
  total,
}: {
  filters: DocumentFilters;
  onFilters: (next: DocumentFilters) => void;
  shown: number;
  total: number;
}) {
  const set = (change: Partial<DocumentFilters>) => onFilters({ ...filters, ...change });
  return (
    <div role="search" aria-label="Search your documents" className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="lib-search" className="min-w-0 flex-[2_1_14rem]">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              id="lib-search"
              type="search"
              autoComplete="off"
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
      </div>
      <Details summary="date range" label="Filter by" lazy={false} defaultOpen={Boolean(filters.from || filters.to)}>
        <div className="flex flex-wrap gap-3">
          <Field label="From" htmlFor="lib-from" className="min-w-0 flex-[1_1_9rem]">
            <Input id="lib-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set({ from: event.target.value })} />
          </Field>
          <Field label="To" htmlFor="lib-to" className="min-w-0 flex-[1_1_9rem]">
            <Input id="lib-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set({ to: event.target.value })} />
          </Field>
        </div>
      </Details>
      <p className="m-0 text-small text-ink-2" aria-live="polite">
        Showing {shown} of {total} {total === 1 ? "document" : "documents"}
        {hasActiveFilters(filters) ? (
          <Button variant="link" className="ml-3 min-h-11 text-small" onClick={() => onFilters(EMPTY_FILTERS)}>Clear filters</Button>
        ) : null}
      </p>
    </div>
  );
}
